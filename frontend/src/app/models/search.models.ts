export interface FacetItem {
  value: string;
  label: string;
  count: number;
  selected: boolean;
}

export interface ProductListItem {
  id: string;
  name: string;
  imageUrl: string;
  brand: string;
  categories: string[];
}

export interface SearchResponse {
  items: ProductListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  facets: {
    brands: FacetItem[];
    categories: FacetItem[];
  };
}

export interface CategorySuggestResponse {
  items: FacetItem[];
}
