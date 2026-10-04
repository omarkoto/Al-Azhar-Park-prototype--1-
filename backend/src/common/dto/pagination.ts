import { z } from 'zod';
import { PageMeta } from '../http/envelope';

export const MAX_PAGE_SIZE = 100;

/** `?page=1&limit=20&search=&sortBy=&sortOrder=asc|desc` — shared by every list endpoint. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
  sortBy: z.string().trim().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function toSkipTake({ page, limit }: Pick<PaginationQuery, 'page' | 'limit'>) {
  return { skip: (page - 1) * limit, take: limit };
}

export function buildMeta({ page, limit }: Pick<PaginationQuery, 'page' | 'limit'>, total: number): PageMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Only allow sorting by columns the endpoint explicitly whitelists (never pass raw input to the ORM). */
export function safeSortField<T extends string>(requested: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(requested as T) ? (requested as T) : fallback;
}
