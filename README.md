# Faceted product search (take-home)

Small Amazon-style faceted search over a subset of [Open Food Facts](https://world.openfoodfacts.org/) data.

<p align="center">
  <a href="https://faceted-search-drab.vercel.app/search" style="font-size:1.3em;">
    🚀 <strong>Live Demo</strong> &nbsp;|&nbsp; faceted-search-drab.vercel.app/search
  </a>
</p>

## Stack

| Layer    | Technology                                            |
| -------- | ----------------------------------------------------- |
| Frontend | Angular 19 (standalone), HttpClient, router URL state |
| Backend  | Node.js 18+, Express                                  |
| Database | Supabase                                              |
| Import   | Node script calling Open Food Facts search API        |

## Repository layout

```
sql/schema.sql           # DDL + indexes
scripts/                 # Open Food Facts import
backend/                 # Express API
frontend/                # Angular app
.env.example             # Environment template
ENGINEERING_NOTES.md     # Design notes and tradeoffs
```

## Prerequisites

- Node.js **18+**
- A **Supabase** project (or any Postgres 14+)
- Network access for the **one-time import** (calls Open Food Facts)

## Environment variables

Copy `.env.example` to `.env` at the **repository root**. The backend and import script load `dotenv` from the root `.env` first, then `backend/.env` (see `scripts/src/loadEnv.js`).

| Variable       | Required | Description                                                                                          |
| -------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Yes      | Postgres connection URI (Supabase: port **5432**, not the pooler port if you avoid PgBouncer issues) |
| `PORT`         | No       | API port (default **3000**)                                                                          |

Optional import tuning (see `.env.example`):

- `IMPORT_MAX_PRODUCTS` (default `11000`)
- `IMPORT_PAGE_SIZE` (max `100`)
- `IMPORT_REQUEST_DELAY_MS`
- `IMPORT_START_PAGE` (resume on the **first** country strategy only)
- `IMPORT_FETCH_RETRIES` (default `6`), `IMPORT_FETCH_TIMEOUT_MS` (default `90000`)

## 1. Apply the database schema

Run `sql/schema.sql` once against your database (Supabase SQL editor, `psql`, or any client):

```bash
psql "$DATABASE_URL" -f sql/schema.sql
```

## 2. Import data

```bash
cd scripts
npm install
npm run import
```

The script fetches products from Open Food Facts, keeps **English** display fields where the rules allow, **deduplicates brands** by a deterministic canonical key, stores **all** English taxonomy categories per product, and upserts into Postgres (~10800 results).

Transient API failures (**502**, **503**, **504**, **429**, timeouts) are **retried** with exponential backoff. Override with `IMPORT_FETCH_RETRIES` and `IMPORT_FETCH_TIMEOUT_MS` in `.env` if needed.

Re-running the import **updates** existing products by barcode (`products.id`) and refreshes category links.

## 3. Run the API

```bash
cd backend
npm install
npm run dev
```

Health check: `GET http://localhost:3000/health`  
Search: `GET http://localhost:3000/api/search`  
Category typeahead: `GET http://localhost:3000/api/facets/categories`

## 4. Run the frontend

```bash
cd frontend
npm install
npm start
```

Open the dev server URL (`http://localhost:4200/search`).

## API quick reference

**Search** — `GET /api/search`

Query parameters: `q`, repeated `brand`, repeated `category`, `page` (default `1`), `pageSize` (default `20`, max `100`).

**Category facet search** — `GET /api/facets/categories`

Query parameters: `query` (required for non-empty results), `limit` (default `20`), optional `q` and repeated `brand` / `category` for contextual counts.

## Deployment notes

- **Database:** Run `sql/schema.sql` on the target Postgres, then run the import from a trusted environment with `DATABASE_URL`.
- **Backend:** Set `DATABASE_URL` and `PORT` on the host. Ensure outbound access is allowed if you re-run import from CI.
- **Frontend:** Build static assets, serve them behind a CDN or static host, and configure the Angular app to call the **real API origin** in production.
- **CORS:** The API enables `cors()` for all origins; tighten to your frontend origin in production if needed.

### Vercel

The repo includes `vercel.json`, a root `package.json` (API dependencies for the serverless entry), and `api/server.js`, which re-exports the Express `app`. The Angular build is static; `/api/*` and `/health` are handled by a serverless function.

The import script (`scripts/`) is not run on Vercel — run imports locally or in CI against the same database.

For more on design choices, see [ENGINEERING_NOTES.md](./ENGINEERING_NOTES.md).
