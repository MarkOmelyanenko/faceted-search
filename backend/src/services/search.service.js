import { pool } from "../db/pool.js";
import * as searchQueries from "../db/search.queries.js";
import { parseSearchQuery } from "../utils/parseQueryParams.js";
import { canonicalToFacetValue } from "../utils/normalize.js";
import { escapeLike } from "../utils/escapeLike.js";

const DEFAULT_CATEGORY_SIDEBAR = 30;
const CATEGORY_FACET_FETCH_CAP = 80;
const BRAND_FACET_CAP = 200;
const MIN_CATEGORY_COUNT_FOR_DEFAULT_SIDEBAR = 2;

/**
 * @param {string} qNormalized
 * @returns {string | null}
 */
function productNameLikePattern(qNormalized) {
  if (!qNormalized) return null;
  return `%${escapeLike(qNormalized)}%`;
}

/**
 * @param {string[]} selectedOrder
 * @param {{ canonicalName: string, label: string, count: number }[]} rows
 */
function mergeCategoryFacetRows(selectedOrder, rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.canonicalName)) map.set(r.canonicalName, r);
  }
  const merged = [...map.values()];
  const selectedSet = new Set(selectedOrder);
  const selected = [];
  for (const c of selectedOrder) {
    const row = merged.find((x) => x.canonicalName === c);
    if (row) selected.push(row);
  }
  const rest = merged.filter((r) => !selectedSet.has(r.canonicalName));
  rest.sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
  return [...selected, ...rest];
}

/**
 * @param {import("../utils/parseQueryParams.js").SearchQuery} parsed
 */
export async function search(rawQuery) {
  const parsed = parseSearchQuery(rawQuery);
  const nameLikePattern = productNameLikePattern(parsed.qNormalized);

  const brandIds = await searchQueries.resolveBrandIds(pool, parsed.brandCanonicals);
  const categoryIds = await searchQueries.resolveCategoryIds(pool, parsed.categoryCanonicals);

  const mainFilters = {
    nameLikePattern,
    brandIds,
    categoryIds,
  };

  const brandFacetFilters = {
    nameLikePattern,
    brandIds: [],
    categoryIds,
  };

  const categoryFacetFilters = {
    nameLikePattern,
    brandIds,
    categoryIds: [],
  };

  const offset = (parsed.page - 1) * parsed.pageSize;

  const [total, pageRows, brandFacetRows, categoryTopRows] = await Promise.all([
    searchQueries.countProducts(pool, mainFilters),
    searchQueries.selectProductPage(pool, mainFilters, parsed.pageSize, offset),
    searchQueries.selectBrandFacetCounts(pool, brandFacetFilters, BRAND_FACET_CAP),
    searchQueries.selectCategoryFacetCounts(
      pool,
      categoryFacetFilters,
      CATEGORY_FACET_FETCH_CAP,
      MIN_CATEGORY_COUNT_FOR_DEFAULT_SIDEBAR,
    ),
  ]);

  const selectedCategorySet = new Set(parsed.categoryCanonicals);
  const baseSidebar = categoryTopRows.slice(0, DEFAULT_CATEGORY_SIDEBAR);

  const byCanon = (canon) => (r) => r.canonicalName === canon;
  const missingCountsFor = parsed.categoryCanonicals.filter(
    (c) => !categoryTopRows.some(byCanon(c)),
  );
  const extraCategoryRows =
    missingCountsFor.length > 0
      ? await searchQueries.selectCategoryFacetCountsForCanonicals(
          pool,
          categoryFacetFilters,
          missingCountsFor,
        )
      : [];

  const countByCanon = new Map();
  for (const r of categoryTopRows) countByCanon.set(r.canonicalName, r);
  for (const r of extraCategoryRows) countByCanon.set(r.canonicalName, r);

  const missingZeroSelected = parsed.categoryCanonicals.filter((c) => !countByCanon.has(c));
  const labelRows =
    missingZeroSelected.length > 0
      ? await searchQueries.selectCategoryLabelsByCanonicals(pool, missingZeroSelected)
      : [];
  for (const l of labelRows) {
    countByCanon.set(l.canonicalName, {
      canonicalName: l.canonicalName,
      label: l.label,
      count: 0,
    });
  }

  const categoryRowsForResponse = [...baseSidebar];
  for (const c of parsed.categoryCanonicals) {
    if (categoryRowsForResponse.some(byCanon(c))) continue;
    const row = countByCanon.get(c);
    if (row) categoryRowsForResponse.push(row);
  }

  const categoryFacetMerged = mergeCategoryFacetRows(
    parsed.categoryCanonicals,
    categoryRowsForResponse,
  );

  const selectedBrandSet = new Set(parsed.brandCanonicals);

  const totalPages = parsed.pageSize > 0 ? Math.ceil(total / parsed.pageSize) : 0;

  return {
    items: pageRows.map((row) => ({
      id: String(row.id),
      name: row.name,
      imageUrl: row.imageUrl ?? "",
      brand: row.brandName ?? "",
      categories: Array.isArray(row.categories) ? row.categories : [],
    })),
    pagination: {
      page: parsed.page,
      pageSize: parsed.pageSize,
      total,
      totalPages,
    },
    facets: {
      brands: brandFacetRows.map((r) => ({
        value: canonicalToFacetValue(r.canonicalName),
        label: r.label,
        count: r.count,
        selected: selectedBrandSet.has(r.canonicalName),
      })),
      categories: categoryFacetMerged.map((r) => ({
        value: canonicalToFacetValue(r.canonicalName),
        label: r.label,
        count: r.count,
        selected: selectedCategorySet.has(r.canonicalName),
      })),
    },
  };
}
