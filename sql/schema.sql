CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE brands (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL UNIQUE
);

CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL UNIQUE
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  image_url TEXT,
  brand_id BIGINT REFERENCES brands(id) ON DELETE SET NULL
);

CREATE TABLE product_categories (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);

CREATE INDEX idx_products_brand_id ON products (brand_id);
CREATE INDEX idx_products_normalized_name_trgm ON products USING gin (normalized_name gin_trgm_ops);
CREATE INDEX idx_product_categories_category_id ON product_categories (category_id);
CREATE INDEX idx_product_categories_product_id ON product_categories (product_id);
