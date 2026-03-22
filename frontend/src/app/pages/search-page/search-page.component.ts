import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Params, Router } from '@angular/router';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  of,
  switchMap,
  tap,
} from 'rxjs';
import type { FacetItem, SearchResponse } from '../../models/search.models';
import { CatalogApiService } from '../../services/catalog-api.service';

interface UiState {
  q: string;
  brands: string[];
  categories: string[];
  page: number;
  pageSize: number;
}

function clampInt(v: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

@Component({
  selector: 'app-search-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './search-page.component.html',
  styleUrl: './search-page.component.css',
})
export class SearchPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(CatalogApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly brandQueryControl = new FormControl('', { nonNullable: true });
  readonly categoryQueryControl = new FormControl('', { nonNullable: true });

  loading = false;
  error: string | null = null;
  result: SearchResponse | null = null;
  brandSuggest: FacetItem[] = [];
  brandSuggestLoading = false;
  categorySuggest: FacetItem[] = [];
  categorySuggestLoading = false;

  constructor() {
    this.route.queryParamMap
      .pipe(
        tap((qp) => {
          this.searchControl.setValue(qp.get('q') ?? '', { emitEvent: false });
        }),
        switchMap((qp) => {
          this.loading = true;
          this.error = null;
          const state = this.parseParamMap(qp);
          return this.api.search(state).pipe(
            catchError(() => {
              this.error = 'Could not load results. Is the API running?';
              return of(null);
            }),
            finalize(() => {
              this.loading = false;
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.result = res;
      });

    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => {
        this.navigateReplace({ q, page: 1 });
      });

    this.brandQueryControl.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((raw) => {
          const term = raw.trim();
          if (!term) {
            this.brandSuggest = [];
            return of({ items: [] as FacetItem[] });
          }
          const s = this.parseParamMap(this.route.snapshot.queryParamMap);
          this.brandSuggestLoading = true;
          return this.api
            .searchBrands({
              query: term,
              q: s.q,
              brands: s.brands,
              categories: s.categories,
              limit: 20,
            })
            .pipe(
              catchError(() => of({ items: [] as FacetItem[] })),
              finalize(() => {
                this.brandSuggestLoading = false;
              }),
            );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        this.brandSuggest = r.items;
      });

    this.categoryQueryControl.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((raw) => {
          const term = raw.trim();
          if (!term) {
            this.categorySuggest = [];
            return of({ items: [] as FacetItem[] });
          }
          const s = this.parseParamMap(this.route.snapshot.queryParamMap);
          this.categorySuggestLoading = true;
          return this.api
            .searchCategories({
              query: term,
              q: s.q,
              brands: s.brands,
              categories: s.categories,
              limit: 20,
            })
            .pipe(
              catchError(() => of({ items: [] as FacetItem[] })),
              finalize(() => {
                this.categorySuggestLoading = false;
              }),
            );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        this.categorySuggest = r.items;
      });
  }

  parseParamMap(qp: ParamMap): UiState {
    return {
      q: qp.get('q') ?? '',
      brands: qp.getAll('brand'),
      categories: qp.getAll('category'),
      page: clampInt(qp.get('page'), 1, 1, 1_000_000),
      pageSize: clampInt(qp.get('pageSize'), 20, 1, 100),
    };
  }

  private toQueryParams(s: UiState): Params {
    return {
      q: s.q.trim() ? s.q.trim() : null,
      brand: s.brands.length ? s.brands : null,
      category: s.categories.length ? s.categories : null,
      page: s.page,
      pageSize: s.pageSize,
    };
  }

  private navigateReplace(patch: Partial<UiState>): void {
    const cur = this.parseParamMap(this.route.snapshot.queryParamMap);
    const next: UiState = { ...cur, ...patch };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.toQueryParams(next),
      queryParamsHandling: '',
    });
  }

  toggleBrand(value: string): void {
    const cur = this.parseParamMap(this.route.snapshot.queryParamMap);
    const set = new Set(cur.brands);
    if (set.has(value)) {
      set.delete(value);
    } else {
      set.add(value);
    }
    this.brandQueryControl.setValue('', { emitEvent: false });
    this.brandSuggest = [];
    this.navigateReplace({ brands: [...set], page: 1 });
  }

  toggleCategory(value: string): void {
    const cur = this.parseParamMap(this.route.snapshot.queryParamMap);
    const set = new Set(cur.categories);
    if (set.has(value)) {
      set.delete(value);
    } else {
      set.add(value);
    }
    this.categoryQueryControl.setValue('', { emitEvent: false });
    this.categorySuggest = [];
    this.navigateReplace({ categories: [...set], page: 1 });
  }

  goToPage(page: number): void {
    this.navigateReplace({ page });
  }

  hasBrandsSelected(): boolean {
    return this.parseParamMap(this.route.snapshot.queryParamMap).brands.length > 0;
  }

  hasCategoriesSelected(): boolean {
    return this.parseParamMap(this.route.snapshot.queryParamMap).categories.length > 0;
  }

  clearBrands(): void {
    if (!this.hasBrandsSelected()) {
      return;
    }
    this.brandQueryControl.setValue('', { emitEvent: false });
    this.brandSuggest = [];
    this.navigateReplace({ brands: [], page: 1 });
  }

  clearCategories(): void {
    if (!this.hasCategoriesSelected()) {
      return;
    }
    this.categoryQueryControl.setValue('', { emitEvent: false });
    this.categorySuggest = [];
    this.navigateReplace({ categories: [], page: 1 });
  }
}
