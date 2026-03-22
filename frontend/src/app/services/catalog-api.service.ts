import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { CategorySuggestResponse, SearchResponse } from '../models/search.models';

export interface SearchRequestState {
  q: string;
  brands: string[];
  categories: string[];
  page: number;
  pageSize: number;
}

@Injectable({ providedIn: 'root' })
export class CatalogApiService {
  private readonly http = inject(HttpClient);

  search(state: SearchRequestState): Observable<SearchResponse> {
    let params = new HttpParams()
      .set('page', String(state.page))
      .set('pageSize', String(state.pageSize));
    if (state.q.trim()) {
      params = params.set('q', state.q.trim());
    }
    for (const b of state.brands) {
      params = params.append('brand', b);
    }
    for (const c of state.categories) {
      params = params.append('category', c);
    }
    return this.http.get<SearchResponse>('/api/search', { params });
  }

  searchCategories(args: {
    query: string;
    q: string;
    brands: string[];
    categories: string[];
    limit: number;
  }): Observable<CategorySuggestResponse> {
    let params = new HttpParams().set('query', args.query).set('limit', String(args.limit));
    if (args.q.trim()) {
      params = params.set('q', args.q.trim());
    }
    for (const b of args.brands) {
      params = params.append('brand', b);
    }
    for (const c of args.categories) {
      params = params.append('category', c);
    }
    return this.http.get<CategorySuggestResponse>('/api/facets/categories', { params });
  }

  searchBrands(args: {
    query: string;
    q: string;
    brands: string[];
    categories: string[];
    limit: number;
  }): Observable<CategorySuggestResponse> {
    let params = new HttpParams().set('query', args.query).set('limit', String(args.limit));
    if (args.q.trim()) {
      params = params.set('q', args.q.trim());
    }
    for (const b of args.brands) {
      params = params.append('brand', b);
    }
    for (const c of args.categories) {
      params = params.append('category', c);
    }
    return this.http.get<CategorySuggestResponse>('/api/facets/brands', { params });
  }
}
