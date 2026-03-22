import { pool } from "../db/pool.js";
import * as facetQueries from "../db/facet.queries.js";
import * as searchQueries from "../db/search.queries.js";
import { parseCategoryFacetSearchQuery } from "../utils/parseQueryParams.js";
import { canonicalToFacetValue } from "../utils/normalize.js";
import { escapeLike } from "../utils/escapeLike.js";

/**
 * @param {Record<string, string | string[] | undefined>} rawQuery
 */
export async function searchCategories(rawQuery) {
  const parsed = parseCategoryFacetSearchQuery(rawQuery);
  if (!parsed.query.trim()) {
    return { items: [] };
  }

  const nameLikePattern = parsed.qNormalized
    ? `%${escapeLike(parsed.qNormalized)}%`
    : null;
  const brandIds = await searchQueries.resolveBrandIds(pool, parsed.brandCanonicals);

  const rawTrim = parsed.query.trim();
  const categoryNamePattern = `%${escapeLike(rawTrim)}%`;
  const categoryCanonicalPattern = parsed.queryNormalized
    ? `%${escapeLike(parsed.queryNormalized)}%`
    : null;

  const rows = await facetQueries.searchCategoriesWithCounts(pool, {
    categoryNamePattern,
    categoryCanonicalPattern,
    nameLikePattern,
    brandIds,
    limit: parsed.limit,
  });

  const selectedCategorySet = new Set(parsed.categoryCanonicals);

  return {
    items: rows.map((r) => ({
      value: canonicalToFacetValue(r.canonicalName),
      label: r.label,
      count: r.count,
      selected: selectedCategorySet.has(r.canonicalName),
    })),
  };
}

/**
 * @param {Record<string, string | string[] | undefined>} rawQuery
 */
export async function searchBrands(rawQuery) {
  const parsed = parseCategoryFacetSearchQuery(rawQuery);
  if (!parsed.query.trim()) {
    return { items: [] };
  }

  const nameLikePattern = parsed.qNormalized
    ? `%${escapeLike(parsed.qNormalized)}%`
    : null;
  const categoryIds = await searchQueries.resolveCategoryIds(pool, parsed.categoryCanonicals);

  const rawTrim = parsed.query.trim();
  const brandNamePattern = `%${escapeLike(rawTrim)}%`;
  const brandCanonicalPattern = parsed.queryNormalized
    ? `%${escapeLike(parsed.queryNormalized)}%`
    : null;

  const rows = await facetQueries.searchBrandsWithCounts(pool, {
    brandNamePattern,
    brandCanonicalPattern,
    nameLikePattern,
    categoryIds,
    limit: parsed.limit,
  });

  const selectedBrandSet = new Set(parsed.brandCanonicals);

  return {
    items: rows.map((r) => ({
      value: canonicalToFacetValue(r.canonicalName),
      label: r.label,
      count: r.count,
      selected: selectedBrandSet.has(r.canonicalName),
    })),
  };
}
