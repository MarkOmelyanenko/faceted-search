import "./loadEnv.js";
import pg from "pg";
import {
  collapseWhitespace,
  normalizeForCanonical,
  normalizeProductNameForIndex,
  slugToDisplayLabel,
} from "../../backend/src/utils/normalize.js";

const { Pool } = pg;

const BASE = "https://world.openfoodfacts.org/cgi/search.pl";

const SEARCH_STRATEGIES = [
  {
    label: "en:united-states",
    qs: "tagtype_0=countries&tag_contains_0=contains&tag_0=en:united-states",
  },
  {
    label: "en:united-kingdom",
    qs: "tagtype_0=countries&tag_contains_0=contains&tag_0=en:united-kingdom",
  },
  {
    label: "en:canada",
    qs: "tagtype_0=countries&tag_contains_0=contains&tag_0=en:canada",
  },
  {
    label: "en:australia",
    qs: "tagtype_0=countries&tag_contains_0=contains&tag_0=en:australia",
  },
  {
    label: "en:ireland",
    qs: "tagtype_0=countries&tag_contains_0=contains&tag_0=en:ireland",
  },
  { label: "global", qs: "" },
];

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const MAX_PRODUCTS = envInt("IMPORT_MAX_PRODUCTS", 11_000);
const PAGE_SIZE = Math.min(100, Math.max(1, envInt("IMPORT_PAGE_SIZE", 100)));
const REQUEST_DELAY_MS = envInt("IMPORT_REQUEST_DELAY_MS", 100);
const START_PAGE = envInt("IMPORT_START_PAGE", 1);
const FETCH_RETRIES = Math.max(1, envInt("IMPORT_FETCH_RETRIES", 6));
const FETCH_TIMEOUT_MS = Math.max(
  5000,
  envInt("IMPORT_FETCH_TIMEOUT_MS", 90_000),
);

const RETRYABLE_HTTP = new Set([408, 429, 500, 502, 503, 504]);

/**
 * @typedef {object} PreparedProduct
 * @property {string} code
 * @property {string} name
 * @property {string} normalizedName
 * @property {string | null} imageUrl
 * @property {string | null} brandCanonical
 * @property {string | null} brandDisplay
 * @property {string[]} categorySlugs
 */

function pickEnglishProductName(p) {
  const pne = collapseWhitespace(String(p.product_name_en ?? ""));
  if (pne.length >= 2) return pne;

  const gne = collapseWhitespace(String(p.generic_name_en ?? ""));
  if (gne.length >= 2) return gne;

  const lc = String(p.lc ?? p.lang ?? "").toLowerCase();
  if (lc === "en") {
    const pn = collapseWhitespace(String(p.product_name ?? ""));
    if (pn.length >= 2) return pn;
  }

  return null;
}

function englishCategorySlugs(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    if (!t.startsWith("en:")) continue;
    const slug = t.slice(3).trim();
    if (slug) out.push(slug);
  }
  return out;
}

function pickBrandRaw(p) {
  const brands = String(p.brands ?? "").trim();
  if (brands) {
    const first = collapseWhitespace(brands.split(/[,;/]/)[0] ?? "");
    if (first) return first;
  }
  const tag0 = Array.isArray(p.brands_tags) ? p.brands_tags[0] : null;
  if (typeof tag0 === "string" && tag0.trim()) {
    const cleaned = tag0.replace(/^en:/, "");
    return slugToDisplayLabel(cleaned) || cleaned;
  }
  return null;
}

function pickImageUrl(p) {
  const a = String(p.image_front_small_url ?? "").trim();
  if (a) return a;
  const b = String(p.image_front_url ?? "").trim();
  if (b) return b;
  const c = String(p.image_url ?? "").trim();
  return c || null;
}

function pickProductCode(p) {
  const c = String(p.code ?? p._id ?? "").trim();
  return c || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {number} page
 * @param {string} strategyQs
 */
function buildSearchUrl(page, strategyQs) {
  const u = new URL(BASE);
  u.searchParams.set("action", "process");
  u.searchParams.set("json", "true");
  u.searchParams.set("page_size", String(PAGE_SIZE));
  u.searchParams.set("page", String(page));
  if (strategyQs) {
    for (const part of strategyQs.split("&")) {
      if (!part) continue;
      const [k, v] = part.split("=");
      if (k) u.searchParams.set(k, v ?? "");
    }
  }
  return u.toString();
}

/**
 * @param {number} page
 * @param {string} strategyQs
 */
async function fetchPage(page, strategyQs) {
  const url = buildSearchUrl(page, strategyQs);
  let lastErr;

  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "FacetedSearchImport/1.0 (assignment; contact: local)",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (res.ok) {
        return await res.json();
      }

      const status = res.status;
      const bodyPreview = await res.text().then((t) => t.slice(0, 120));
      lastErr = new Error(
        `Open Food Facts HTTP ${status}${bodyPreview ? `: ${bodyPreview}` : ""}`,
      );

      if (!RETRYABLE_HTTP.has(status) || attempt >= FETCH_RETRIES) {
        throw lastErr;
      }

      const waitMs = backoffMsForAttempt(res, attempt);
      console.warn(
        `Open Food Facts HTTP ${status} (page ${page}), attempt ${attempt}/${FETCH_RETRIES} — waiting ${waitMs}ms`,
      );
      await sleep(waitMs);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt >= FETCH_RETRIES) {
        throw lastErr;
      }
      const isAbort =
        lastErr.name === "TimeoutError" || lastErr.name === "AbortError";
      const isNetwork =
        lastErr.message.includes("fetch failed") ||
        lastErr.message.includes("Failed to fetch") ||
        lastErr.message.includes("ECONNRESET") ||
        lastErr.message.includes("ETIMEDOUT") ||
        lastErr.message.includes("socket");
      if (!isAbort && !isNetwork) {
        throw lastErr;
      }

      const waitMs = Math.min(
        45_000,
        1500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 800),
      );
      console.warn(
        `${lastErr.name || "Error"} on page ${page} (${lastErr.message.slice(0, 80)}), attempt ${attempt}/${FETCH_RETRIES} — waiting ${waitMs}ms`,
      );
      await sleep(waitMs);
    }
  }

  throw lastErr ?? new Error("fetchPage: exhausted retries");
}

/**
 * @param {Response} res
 * @param {number} attempt 1-based
 */
function backoffMsForAttempt(res, attempt) {
  const ra = res.headers.get("retry-after");
  if (ra) {
    const sec = Number.parseFloat(ra);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(
        120_000,
        Math.ceil(sec * 1000) + Math.floor(Math.random() * 400),
      );
    }
  }
  return Math.min(
    60_000,
    2000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 1000),
  );
}

/**
 * @param {Record<string, unknown>} p
 * @returns {PreparedProduct | null}
 */
function tryPrepareProduct(p) {
  const code = pickProductCode(p);
  if (!code) return null;

  const name = pickEnglishProductName(p);
  if (!name) return null;

  const normalizedName = normalizeProductNameForIndex(name);
  if (!normalizedName) return null;

  const imageUrl = pickImageUrl(p);
  const brandRaw = pickBrandRaw(p);
  let brandCanonical = null;
  let brandDisplay = null;
  if (brandRaw) {
    const display = collapseWhitespace(brandRaw);
    const canonical = normalizeForCanonical(display);
    if (canonical) {
      brandCanonical = canonical;
      brandDisplay = display;
    }
  }

  return {
    code,
    name,
    normalizedName,
    imageUrl,
    brandCanonical,
    brandDisplay,
    categorySlugs: englishCategorySlugs(p.categories_tags),
  };
}

/**
 * @param {import("pg").PoolClient} client
 * @param {Map<string, number>} cache
 * @param {Map<string, string>} canonicalToDisplay
 */
async function bulkEnsureBrands(client, cache, canonicalToDisplay) {
  if (canonicalToDisplay.size === 0) return;

  const names = [];
  const canons = [];
  for (const [canonical, display] of canonicalToDisplay) {
    canons.push(canonical);
    names.push(display);
  }

  await client.query(
    `INSERT INTO brands (name, canonical_name)
     SELECT * FROM unnest($1::text[], $2::text[]) AS t(name, canonical_name)
     ON CONFLICT (canonical_name) DO NOTHING`,
    [names, canons],
  );

  const res = await client.query(
    `SELECT id, canonical_name FROM brands WHERE canonical_name = ANY($1::text[])`,
    [canons],
  );
  for (const row of res.rows) {
    cache.set(row.canonical_name, Number(row.id));
  }
}

/**
 * @param {import("pg").PoolClient} client
 * @param {Map<string, number>} cache
 * @param {Set<string>} slugs
 */
async function bulkEnsureCategories(client, cache, slugs) {
  if (slugs.size === 0) return;

  /** @type {Map<string, string>} */
  const byCanon = new Map();
  for (const slug of slugs) {
    const label = slugToDisplayLabel(slug);
    const canonical = normalizeForCanonical(slug.replace(/-/g, " "));
    if (!canonical) continue;
    const name = label || slug.replace(/-/g, " ");
    if (!byCanon.has(canonical)) {
      byCanon.set(canonical, name);
    }
  }

  const canons = [...byCanon.keys()];
  const names = canons.map((c) => byCanon.get(c) ?? c);

  if (!canons.length) return;

  await client.query(
    `INSERT INTO categories (name, canonical_name)
     SELECT * FROM unnest($1::text[], $2::text[]) AS t(name, canonical_name)
     ON CONFLICT (canonical_name) DO NOTHING`,
    [names, canons],
  );

  const res = await client.query(
    `SELECT id, canonical_name FROM categories WHERE canonical_name = ANY($1::text[])`,
    [canons],
  );
  for (const row of res.rows) {
    cache.set(row.canonical_name, Number(row.id));
  }
}

/**
 * @param {import("pg").PoolClient} client
 * @param {PreparedProduct[]} rows
 * @param {Map<string, number>} brandCache
 * @param {Map<string, number>} categoryCache
 */
async function bulkUpsertPage(client, rows, brandCache, categoryCache) {
  if (rows.length === 0) return;

  const brandMap = new Map();
  for (const r of rows) {
    if (r.brandCanonical && r.brandDisplay) {
      if (!brandMap.has(r.brandCanonical)) {
        brandMap.set(r.brandCanonical, r.brandDisplay);
      }
    }
  }

  const categorySlugSet = new Set();
  for (const r of rows) {
    for (const s of r.categorySlugs) categorySlugSet.add(s);
  }

  await bulkEnsureBrands(client, brandCache, brandMap);
  await bulkEnsureCategories(client, categoryCache, categorySlugSet);

  const ids = [];
  const names = [];
  const norms = [];
  const images = [];
  const brandIds = [];
  for (const r of rows) {
    ids.push(r.code);
    names.push(r.name);
    norms.push(r.normalizedName);
    images.push(r.imageUrl);
    brandIds.push(
      r.brandCanonical != null
        ? (brandCache.get(r.brandCanonical) ?? null)
        : null,
    );
  }

  await client.query(
    `INSERT INTO products (id, name, normalized_name, image_url, brand_id)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::bigint[])
     AS t(id, name, normalized_name, image_url, brand_id)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       normalized_name = EXCLUDED.normalized_name,
       image_url = EXCLUDED.image_url,
       brand_id = EXCLUDED.brand_id`,
    [ids, names, norms, images, brandIds],
  );

  await client.query(
    `DELETE FROM product_categories WHERE product_id = ANY($1::text[])`,
    [ids],
  );

  const pcProductIds = [];
  const pcCategoryIds = [];
  const pairSeen = new Set();
  for (const r of rows) {
    const seenCats = new Set();
    for (const slug of r.categorySlugs) {
      const canonical = normalizeForCanonical(slug.replace(/-/g, " "));
      if (!canonical) continue;
      const cid = categoryCache.get(canonical);
      if (cid == null) continue;
      if (seenCats.has(cid)) continue;
      seenCats.add(cid);
      const key = `${r.code}:${cid}`;
      if (pairSeen.has(key)) continue;
      pairSeen.add(key);
      pcProductIds.push(r.code);
      pcCategoryIds.push(cid);
    }
  }

  if (pcProductIds.length > 0) {
    await client.query(
      `INSERT INTO product_categories (product_id, category_id)
       SELECT * FROM unnest($1::text[], $2::bigint[]) AS t(product_id, category_id)
       ON CONFLICT (product_id, category_id) DO NOTHING`,
      [pcProductIds, pcCategoryIds],
    );
  }
}

/**
 * @param {import("pg").PoolClient} client
 * @param {Record<string, unknown>[]} products
 * @param {number} imported
 * @param {Map<string, number>} brandCache
 * @param {Map<string, number>} categoryCache
 * @returns {{ added: number, skipped: number }}
 */
async function processPageBatch(
  client,
  products,
  imported,
  brandCache,
  categoryCache,
) {
  const remaining = MAX_PRODUCTS - imported;
  if (remaining <= 0) return { added: 0, skipped: 0 };

  const prepared = [];
  let skipped = 0;
  for (const p of products) {
    if (prepared.length >= remaining) break;
    const row = tryPrepareProduct(p);
    if (!row) {
      skipped += 1;
      continue;
    }
    prepared.push(row);
  }

  if (prepared.length > 0) {
    await bulkUpsertPage(client, prepared, brandCache, categoryCache);
  }

  return { added: prepared.length, skipped };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  console.log(
    `Import: maxProducts=${MAX_PRODUCTS}, pageSize=${PAGE_SIZE}, delayMs=${REQUEST_DELAY_MS}, startPage=${START_PAGE}, fetchRetries=${FETCH_RETRIES}, fetchTimeoutMs=${FETCH_TIMEOUT_MS} (bulk SQL + overlapped fetch)`,
  );

  const pool = new Pool({ connectionString, max: 5 });
  const brandCache = new Map();
  const categoryCache = new Map();

  let imported = 0;
  let skipped = 0;

  try {
    for (let si = 0; si < SEARCH_STRATEGIES.length; si++) {
      if (imported >= MAX_PRODUCTS) break;

      const strategy = SEARCH_STRATEGIES[si];
      let page = si === 0 ? START_PAGE : 1;

      let fetchPromise = fetchPage(page, strategy.qs);

      while (imported < MAX_PRODUCTS) {
        const data = await fetchPromise;
        const products = Array.isArray(data.products) ? data.products : [];
        if (products.length === 0) {
          console.log(
            `Strategy ${strategy.label}: no more products at page ${page}.`,
          );
          break;
        }

        const pageCount = Number(data.page_count);
        const nextPage = page + 1;
        const canFetchNext =
          imported < MAX_PRODUCTS &&
          (!Number.isFinite(pageCount) || nextPage <= pageCount);

        fetchPromise = canFetchNext
          ? fetchPage(nextPage, strategy.qs)
          : Promise.resolve({ products: [], page_count: pageCount });

        const client = await pool.connect();
        let batchAdded = 0;
        let batchSkipped = 0;
        try {
          await client.query("BEGIN");
          const r = await processPageBatch(
            client,
            products,
            imported,
            brandCache,
            categoryCache,
          );
          batchAdded = r.added;
          batchSkipped = r.skipped;
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }

        imported += batchAdded;
        skipped += batchSkipped;

        console.log(
          `Strategy ${strategy.label} page ${page}. Imported: ${imported}, skipped: ${skipped}`,
        );

        if (Number.isFinite(pageCount) && page >= pageCount) {
          console.log(
            `Strategy ${strategy.label}: reached last page (${pageCount}).`,
          );
          break;
        }

        page = nextPage;

        if (!canFetchNext) break;

        if (REQUEST_DELAY_MS > 0) {
          await sleep(REQUEST_DELAY_MS);
        }
      }
    }

    console.log(
      `Import complete. Imported ${imported} products, skipped ${skipped}.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
