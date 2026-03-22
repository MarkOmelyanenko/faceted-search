/**
 * Parameterized search + facet SQL.
 */

/**
 * @param {import("pg").Pool} pool
 * @param {string[]} canonicals
 * @returns {Promise<number[]>}
 */
export async function resolveBrandIds(pool, canonicals) {
  if (!canonicals.length) return [];
  const r = await pool.query(
    `SELECT id FROM brands WHERE canonical_name = ANY($1::text[])`,
    [canonicals],
  );
  return r.rows.map((row) => Number(row.id));
}

/**
 * @param {import("pg").Pool} pool
 * @param {string[]} canonicals
 * @returns {Promise<number[]>}
 */
export async function resolveCategoryIds(pool, canonicals) {
  if (!canonicals.length) return [];
  const r = await pool.query(
    `SELECT id FROM categories WHERE canonical_name = ANY($1::text[])`,
    [canonicals],
  );
  return r.rows.map((row) => Number(row.id));
}

/**
 * @param {object} o
 * @param {string | null} o.nameLikePattern full LIKE pattern or null to skip
 * @param {number[]} o.brandIds
 * @param {number[]} o.categoryIds
 * @returns {{ where: string, params: unknown[] }}
 */
export function buildProductWhere({ nameLikePattern, brandIds, categoryIds }) {
  const conditions = [];
  const params = [];
  let n = 1;

  if (nameLikePattern != null) {
    conditions.push(`p.normalized_name LIKE $${n} ESCAPE '\\'`);
    params.push(nameLikePattern);
    n += 1;
  }

  if (brandIds.length > 0) {
    conditions.push(`p.brand_id = ANY($${n}::bigint[])`);
    params.push(brandIds);
    n += 1;
  }

  if (categoryIds.length > 0) {
    conditions.push(
      `EXISTS (
        SELECT 1 FROM product_categories pc0
        WHERE pc0.product_id = p.id AND pc0.category_id = ANY($${n}::bigint[])
      )`,
    );
    params.push(categoryIds);
    n += 1;
  }

  return {
    where: conditions.length ? conditions.join(" AND ") : "TRUE",
    params,
  };
}

/**
 * @param {import("pg").Pool} pool
 * @param {{ nameLikePattern: string | null, brandIds: number[], categoryIds: number[] }} filters
 * @returns {Promise<number>}
 */
export async function countProducts(pool, filters) {
  const { where, params } = buildProductWhere(filters);
  const r = await pool.query(
    `SELECT COUNT(*)::bigint AS c FROM products p WHERE ${where}`,
    params,
  );
  return Number(r.rows[0]?.c ?? 0);
}

/**
 * @param {import("pg").Pool} pool
 * @param {{ nameLikePattern: string | null, brandIds: number[], categoryIds: number[] }} filters
 * @param {number} limit
 * @param {number} offset
 */
export async function selectProductPage(pool, filters, limit, offset) {
  const { where, params } = buildProductWhere(filters);
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const r = await pool.query(
    `
    SELECT
      p.id,
      p.name,
      p.image_url AS "imageUrl",
      b.name AS "brandName",
      COALESCE(
        (
          SELECT array_agg(t.name ORDER BY t.name)
          FROM (
            SELECT DISTINCT c2.name
            FROM product_categories pc2
            INNER JOIN categories c2 ON c2.id = pc2.category_id
            WHERE pc2.product_id = p.id
          ) t
        ),
        ARRAY[]::text[]
      ) AS categories
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE ${where}
    ORDER BY p.name ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    [...params, limit, offset],
  );
  return r.rows;
}

/**
 * Brand facet: apply search + category filters only.
 * @param {import("pg").Pool} pool
 * @param {{ nameLikePattern: string | null, categoryIds: number[] }} filters
 * @param {number} maxRows
 */
export async function selectBrandFacetCounts(pool, filters, maxRows = 200) {
  const { where, params } = buildProductWhere({
    nameLikePattern: filters.nameLikePattern,
    brandIds: [],
    categoryIds: filters.categoryIds,
  });
  const limIdx = params.length + 1;
  const r = await pool.query(
    `
    SELECT
      b.canonical_name AS "canonicalName",
      b.name AS "label",
      COUNT(*)::int AS count
    FROM products p
    INNER JOIN brands b ON b.id = p.brand_id
    WHERE ${where}
    GROUP BY b.id, b.canonical_name, b.name
    ORDER BY count DESC, b.name ASC
    LIMIT $${limIdx}
    `,
    [...params, maxRows],
  );
  return r.rows;
}

/**
 * Category facet: apply search + brand filters only.
 * @param {import("pg").Pool} pool
 * @param {{ nameLikePattern: string | null, brandIds: number[] }} filters
 * @param {number} maxRows
 * @param {number | null} minCount omit rows below this count (sidebar default); null = no floor
 */
export async function selectCategoryFacetCounts(
  pool,
  filters,
  maxRows,
  minCount = null,
) {
  const { where, params } = buildProductWhere({
    nameLikePattern: filters.nameLikePattern,
    brandIds: filters.brandIds,
    categoryIds: [],
  });
  let sql = `
    SELECT
      c.canonical_name AS "canonicalName",
      c.name AS "label",
      COUNT(DISTINCT p.id)::int AS count
    FROM products p
    INNER JOIN product_categories pc ON pc.product_id = p.id
    INNER JOIN categories c ON c.id = pc.category_id
    WHERE ${where}
    GROUP BY c.id, c.canonical_name, c.name
  `;
  const allParams = [...params];
  if (minCount != null) {
    const havingIdx = allParams.length + 1;
    sql += ` HAVING COUNT(DISTINCT p.id) >= $${havingIdx}`;
    allParams.push(minCount);
  }
  const limIdx = allParams.length + 1;
  sql += ` ORDER BY count DESC, c.name ASC LIMIT $${limIdx}`;
  allParams.push(maxRows);
  const r = await pool.query(sql, allParams);
  return r.rows;
}

/**
 * Category counts for specific canonicals (selected but not in top-N sidebar).
 * @param {import("pg").Pool} pool
 * @param {{ nameLikePattern: string | null, brandIds: number[] }} filters
 * @param {string[]} canonicals
 */
export async function selectCategoryFacetCountsForCanonicals(
  pool,
  filters,
  canonicals,
) {
  if (!canonicals.length) return [];
  const { where, params } = buildProductWhere({
    nameLikePattern: filters.nameLikePattern,
    brandIds: filters.brandIds,
    categoryIds: [],
  });
  const canonIdx = params.length + 1;
  const r = await pool.query(
    `
    SELECT
      c.canonical_name AS "canonicalName",
      c.name AS "label",
      COUNT(DISTINCT p.id)::int AS count
    FROM products p
    INNER JOIN product_categories pc ON pc.product_id = p.id
    INNER JOIN categories c ON c.id = pc.category_id
    WHERE ${where}
      AND c.canonical_name = ANY($${canonIdx}::text[])
    GROUP BY c.id, c.canonical_name, c.name
    `,
    [...params, canonicals],
  );
  return r.rows;
}

/**
 * Labels for categories (e.g. selected facet with zero hits in current filter).
 * @param {import("pg").Pool} pool
 * @param {string[]} canonicals
 */
export async function selectCategoryLabelsByCanonicals(pool, canonicals) {
  if (!canonicals.length) return [];
  const r = await pool.query(
    `SELECT canonical_name AS "canonicalName", name AS label FROM categories WHERE canonical_name = ANY($1::text[])`,
    [canonicals],
  );
  return r.rows;
}
