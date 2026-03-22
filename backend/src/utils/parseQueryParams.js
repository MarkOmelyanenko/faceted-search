import { facetValueToCanonical, normalizeProductNameForIndex } from "./normalize.js";

/**
 * @typedef {object} SearchQuery
 * @property {string} q
 * @property {string[]} brandValues
 * @property {string[]} categoryValues
 * @property {string} qNormalized
 * @property {string[]} brandCanonicals
 * @property {string[]} categoryCanonicals
 * @property {number} page
 * @property {number} pageSize
 */

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * @param {string | string[] | undefined} v
 * @returns {string[]}
 */
function toStringArray(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  const s = String(v).trim();
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

/**
 * @param {unknown} v
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
function clampInt(v, fallback, min, max) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * @param {string[]} facetTokens
 * @returns {string[]}
 */
export function facetTokensToCanonicals(facetTokens) {
  const out = [];
  const seen = new Set();
  for (const t of facetTokens) {
    const c = facetValueToCanonical(t);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/**
 * @param {Record<string, string | string[] | undefined>} query
 * @returns {SearchQuery}
 */
export function parseSearchQuery(query) {
  const q = typeof query.q === "string" ? query.q : "";
  const brandValues = toStringArray(query.brand);
  const categoryValues = toStringArray(query.category);
  const qNormalized = normalizeProductNameForIndex(q);
  const page = clampInt(query.page, 1, 1, 1_000_000);
  const pageSize = clampInt(query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

  return {
    q,
    brandValues,
    categoryValues,
    qNormalized,
    brandCanonicals: facetTokensToCanonicals(brandValues),
    categoryCanonicals: facetTokensToCanonicals(categoryValues),
    page,
    pageSize,
  };
}

/**
 * @typedef {object} CategoryFacetSearchQuery
 * @property {string} query
 * @property {string} queryNormalized
 * @property {number} limit
 * @property {string} q
 * @property {string} qNormalized
 * @property {string[]} brandValues
 * @property {string[]} brandCanonicals
 * @property {string[]} categoryCanonicals
 */

/**
 * @param {Record<string, string | string[] | undefined>} query
 * @returns {CategoryFacetSearchQuery}
 */
export function parseCategoryFacetSearchQuery(query) {
  const raw = typeof query.query === "string" ? query.query : "";
  const q = typeof query.q === "string" ? query.q : "";
  const brandValues = toStringArray(query.brand);
  const categoryValues = toStringArray(query.category);
  const limit = clampInt(query.limit, 20, 1, 100);

  return {
    query: raw,
    queryNormalized: normalizeProductNameForIndex(raw),
    limit,
    q,
    qNormalized: normalizeProductNameForIndex(q),
    brandValues,
    brandCanonicals: facetTokensToCanonicals(brandValues),
    categoryCanonicals: facetTokensToCanonicals(categoryValues),
  };
}
