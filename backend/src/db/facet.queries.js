import { buildProductWhere } from "./search.queries.js";

/**
 * Typeahead across all categories; counts use q + brand context (no category facet filter).
 * @param {import("pg").Pool} pool
 * @param {object} o
 * @param {string | null} o.categoryNamePattern ILIKE pattern for categories.name
 * @param {string | null} o.categoryCanonicalPattern LIKE pattern on canonical_name
 * @param {string | null} o.nameLikePattern product name filter
 * @param {number[]} o.brandIds
 * @param {number} o.limit
 */
export async function searchCategoriesWithCounts(pool, o) {
  const productWhere = buildProductWhere({
    nameLikePattern: o.nameLikePattern,
    brandIds: o.brandIds,
    categoryIds: [],
  });

  const conditions = [`(${productWhere.where})`];
  const params = [...productWhere.params];
  let n = params.length + 1;

  const textConds = [];
  if (o.categoryNamePattern != null) {
    textConds.push(`c.name ILIKE $${n} ESCAPE '\\'`);
    params.push(o.categoryNamePattern);
    n += 1;
  }
  if (o.categoryCanonicalPattern != null) {
    textConds.push(`c.canonical_name LIKE $${n} ESCAPE '\\'`);
    params.push(o.categoryCanonicalPattern);
    n += 1;
  }

  if (!textConds.length) {
    return [];
  }

  conditions.push(`(${textConds.join(" OR ")})`);

  const limIdx = params.length + 1;
  params.push(o.limit);

  const whereSql = conditions.join(" AND ");

  const r = await pool.query(
    `
    SELECT
      c.canonical_name AS "canonicalName",
      c.name AS "label",
      COUNT(DISTINCT p.id)::int AS count
    FROM categories c
    INNER JOIN product_categories pc ON pc.category_id = c.id
    INNER JOIN products p ON p.id = pc.product_id
    WHERE ${whereSql}
    GROUP BY c.id, c.canonical_name, c.name
    HAVING COUNT(DISTINCT p.id) > 0
    ORDER BY count DESC, c.name ASC
    LIMIT $${limIdx}
    `,
    params,
  );
  return r.rows;
}

/**
 * Typeahead across brands; counts use q + category context (no brand facet filter).
 * @param {import("pg").Pool} pool
 * @param {object} o
 * @param {string | null} o.brandNamePattern ILIKE pattern for brands.name
 * @param {string | null} o.brandCanonicalPattern LIKE pattern on canonical_name
 * @param {string | null} o.nameLikePattern product name filter
 * @param {number[]} o.categoryIds
 * @param {number} o.limit
 */
export async function searchBrandsWithCounts(pool, o) {
  const productWhere = buildProductWhere({
    nameLikePattern: o.nameLikePattern,
    brandIds: [],
    categoryIds: o.categoryIds,
  });

  const conditions = [`(${productWhere.where})`];
  const params = [...productWhere.params];
  let n = params.length + 1;

  const textConds = [];
  if (o.brandNamePattern != null) {
    textConds.push(`b.name ILIKE $${n} ESCAPE '\\'`);
    params.push(o.brandNamePattern);
    n += 1;
  }
  if (o.brandCanonicalPattern != null) {
    textConds.push(`b.canonical_name LIKE $${n} ESCAPE '\\'`);
    params.push(o.brandCanonicalPattern);
    n += 1;
  }

  if (!textConds.length) {
    return [];
  }

  conditions.push(`(${textConds.join(" OR ")})`);

  const limIdx = params.length + 1;
  params.push(o.limit);

  const whereSql = conditions.join(" AND ");

  const r = await pool.query(
    `
    SELECT
      b.canonical_name AS "canonicalName",
      b.name AS "label",
      COUNT(DISTINCT p.id)::int AS count
    FROM products p
    INNER JOIN brands b ON b.id = p.brand_id
    WHERE ${whereSql}
    GROUP BY b.id, b.canonical_name, b.name
    HAVING COUNT(DISTINCT p.id) > 0
    ORDER BY count DESC, b.name ASC
    LIMIT $${limIdx}
    `,
    params,
  );
  return r.rows;
}
