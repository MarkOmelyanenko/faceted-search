/**
 * Deterministic normalization for import + search (no fuzzy semantic merging).
 * Mirrors DB helpers (unaccent + lower) conceptually.
 */

/**
 * @param {string} input
 * @returns {string}
 */
export function stripDiacritics(input) {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * @param {string} input
 * @returns {string}
 */
export function collapseWhitespace(input) {
  return String(input ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Remove punctuation/symbols; keep letters and numbers from any script. */
const NON_WORD_RE = /[^\p{L}\p{N}\s]+/gu;

/**
 * Core canonical key: lower, unaccent, separators → space, strip punctuation, collapse spaces.
 * Used for brand/category dedupe and product.normalized_name indexing.
 * @param {string} input
 * @returns {string}
 */
export function normalizeForCanonical(input) {
  let s = stripDiacritics(String(input ?? ""));
  s = s.replace(/[-_]+/g, " ");
  s = s.replace(NON_WORD_RE, " ");
  s = collapseWhitespace(s).toLowerCase();
  return s;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function toCanonicalKey(value) {
  return normalizeForCanonical(value);
}

/**
 * Stable search index string for product name (same rules as canonical).
 * @param {string} englishName
 * @returns {string}
 */
export function normalizeProductNameForIndex(englishName) {
  return normalizeForCanonical(englishName);
}

/**
 * Turn canonical key (spaces) into a URL facet token (hyphens).
 * @param {string} canonical
 * @returns {string}
 */
export function canonicalToFacetValue(canonical) {
  return canonical.replace(/\s+/g, "-");
}

/**
 * Parse facet param from URL back to canonical key.
 * @param {string} facetValue
 * @returns {string}
 */
export function facetValueToCanonical(facetValue) {
  return normalizeForCanonical(String(facetValue ?? "").replace(/-/g, " "));
}

/**
 * OFF `en:some-slug` → English display label.
 * @param {string} slugWithoutLang
 * @returns {string}
 */
export function slugToDisplayLabel(slugWithoutLang) {
  const slug = String(slugWithoutLang ?? "").trim();
  if (!slug) return "";
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
