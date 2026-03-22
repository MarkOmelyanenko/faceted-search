/**
 * Escape `%`, `_`, and `\` for PostgreSQL LIKE/ILIKE with ESCAPE '\\'.
 * @param {string} value
 * @returns {string}
 */
export function escapeLike(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
