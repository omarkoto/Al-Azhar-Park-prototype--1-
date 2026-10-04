import { buildMeta, paginationQuerySchema, safeSortField, toSkipTake } from './pagination';

describe('pagination', () => {
  it('uses sensible defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20, search: undefined, sortBy: undefined, sortOrder: 'desc' });
  });

  it('coerces query-string numbers', () => {
    const q = paginationQuerySchema.parse({ page: '3', limit: '50', sortOrder: 'asc', search: '  nile ' });
    expect(q).toMatchObject({ page: 3, limit: 50, sortOrder: 'asc', search: 'nile' });
  });

  it.each([{ page: '0' }, { page: '-1' }, { limit: '0' }, { limit: '101' }, { sortOrder: 'sideways' }, { page: 'abc' }])(
    'rejects %j',
    (input) => {
      expect(paginationQuerySchema.safeParse(input).success).toBe(false);
    },
  );

  it('turns blank search into undefined', () => {
    expect(paginationQuerySchema.parse({ search: '   ' }).search).toBeUndefined();
  });

  it('computes skip/take', () => {
    expect(toSkipTake({ page: 1, limit: 20 })).toEqual({ skip: 0, take: 20 });
    expect(toSkipTake({ page: 3, limit: 25 })).toEqual({ skip: 50, take: 25 });
  });

  it('builds page metadata', () => {
    expect(buildMeta({ page: 2, limit: 20 }, 45)).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 });
    expect(buildMeta({ page: 1, limit: 20 }, 0)).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
  });

  it('only sorts by whitelisted fields', () => {
    expect(safeSortField('createdAt', ['createdAt', 'name'] as const, 'name')).toBe('createdAt');
    expect(safeSortField('passwordHash; DROP TABLE', ['createdAt', 'name'] as const, 'name')).toBe('name');
    expect(safeSortField(undefined, ['createdAt', 'name'] as const, 'name')).toBe('name');
  });
});
