import { SetMetadata } from '@nestjs/common';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: PageMeta | Record<string, unknown>;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/** Return this from a controller to produce `{ data: items, meta }` with pagination metadata. */
export class PageResult<T> {
  constructor(
    readonly items: T[],
    readonly meta: PageMeta,
  ) {}
}

export const SKIP_ENVELOPE = 'skipEnvelope';
/** Opt a route out of the `{ data }` wrapper (health probes, file downloads, PDFs, …). */
export const SkipEnvelope = () => SetMetadata(SKIP_ENVELOPE, true);
