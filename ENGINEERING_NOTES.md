# Engineering notes

This document summarizes why the stack and data flow look the way they do, and what was traded off.

## Why Angular + Express + Supabase

- **Angular**: I chose Angular to stay close to the team’s frontend stack and to make the take-home solution more representative of the technologies used in production. First, I spent some time diving into it, specifically reading the [documentation](https://angular.dev/overview) and watching a few tutorials, for example [this one](https://www.youtube.com/watch?v=k5E2AVpwsko).
- **Express**: As I already have some experience with Spring Boot (which is used by the UI Bakery team), I decided to look into Node.js (which also is used by the UI Bakery team), specifically Express, For the scope of this take-home, Express allowed me to keep the backend lightweight and focused on the search and filtering logic.
- **Supabase**: Assignment requirements.

## Why import locally instead of calling Open Food Facts on each search

User searches would depend on a third-party API rate limits, timeouts, and schema changes - giving us latency and reliability

The tradeoff is that imported data may become stale over time. This can be rectified through manual or scheduled imports. But for this project, a single data import is quite sufficient to demonstrate how faceted search works

## Normalized schema

`brands`, `categories`, `products`, `product_categories` with canonical dedupe keys on brands/categories.

For faceted search with OR-within-facet and AND-across-facets, normalized link tables stay correct and index-friendly.

## Brand deduplication

Brands are deduplicated at import time using a pipeline shared with search indexing (`backend/src/utils/normalize.js`): lowercase, trim, collapse whitespace, strip diacritics, map separators to spaces, strip punctuation, then store:

- `canonical_name` — unique key
- `name` — first-seen display label (`INSERT … ON CONFLICT DO NOTHING` keeps the first label)

Examples like “Nestlé” vs “Nestle” or “Coca-Cola” vs “coca cola” collapse when their canonical keys match.

## English-only display data

At import (`scripts/src/importOpenFoodFacts.js`):

- Product title prefers `product_name_en` / `generic_name_en`, then `product_name` only when the record’s language is English (`lc` / `lang === en`). Otherwise the product is skipped.
- Categories use Open Food Facts `categories_tags` entries prefixed with `en:` so labels stay in the English taxonomy.
- Brands use the `brands` string (first segment) or `brands_tags` as a fallback label.

Some non-English entries might still get imported because Open Food Facts data isn’t always consistent. A stronger follow-up would be to add stricter Unicode script validation or a more conservative language filter during import.

## Facet counts

1. Brand facet counts use the current text search and category filters, but exclude the active brand filter. So counts answer: “If I change my brand selection, how many products match my search and categories for each brand?”
2. Category facet counts use the current text search and brand filters, but exclude the active category filter.

Main result list and total count still apply all filters (search + brand + category).

`query AND (brand1 OR brand2 OR ...) AND (category1 OR category2 OR ...)`

## Category sidebar vs full category search

The database stores the full category graph for correctness. The default `/api/search` response only returns a small slice of categories. The sidebar displays the top categories, excluding those with low product counts, plus all selected categories; and if a selected category returns zero results, a human-readable name is still retrieved from the 'categories' table and '0' is displayed. That keeps the sidebar usable I think.

## One more technical decision: debounced URL updates on the client

The Angular search box debounces input (~300ms) before writing `q` to the router. This reduces the number of navigation errors and duplicate API calls while typing, at the cost of slight delay before the URL reflects the latest keystrokes. Updates may display a query that lags slightly behind the current input — this is a deliberate trade-off in terms of user experience.

## How this could scale further

| Direction              | Idea                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Canonicalization**   | Richer rules (legal entity suffixes, alias tables).                                                                                           |
| **Reimport**           | Scheduled job (weekly/daily), idempotent upserts.                                                                                             |
| **Caching**            | Cache `GET /api/search` keyed by normalized query params or Redis.                                                                            |
| **Materialized views** | Use materialized views to speed up facet counts if some filters are used often and cause slow queries.                                        |
| **Search engine**      | For better search (fewer typos, more languages, or very large databases), use a search engine like OpenSearch, Elasticsearch, or Meilisearch. |
