import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { PageResult, SKIP_ENVELOPE } from '../http/envelope';
import { EnvelopeInterceptor } from './envelope.interceptor';

function context(opts: { statusCode?: number; skip?: boolean; type?: string } = {}): ExecutionContext {
  const handler = () => undefined;
  class Controller {}
  if (opts.skip) Reflect.defineMetadata(SKIP_ENVELOPE, true, handler);
  return {
    getType: () => opts.type ?? 'http',
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({ getResponse: () => ({ statusCode: opts.statusCode ?? 200 }) }),
  } as unknown as ExecutionContext;
}

const run = (value: unknown, ctx: ExecutionContext) =>
  lastValueFrom(new EnvelopeInterceptor(new Reflector()).intercept(ctx, { handle: () => of(value) } as CallHandler) as ReturnType<CallHandler['handle']>);

describe('EnvelopeInterceptor', () => {
  it('wraps a plain value as { data }', async () => {
    await expect(run({ id: 1 }, context())).resolves.toEqual({ data: { id: 1 } });
  });

  it('wraps primitives and arrays', async () => {
    await expect(run([1, 2], context())).resolves.toEqual({ data: [1, 2] });
    await expect(run('ok', context())).resolves.toEqual({ data: 'ok' });
  });

  it('turns undefined into { data: null }', async () => {
    await expect(run(undefined, context())).resolves.toEqual({ data: null });
  });

  it('renders a PageResult as { data, meta }', async () => {
    const page = new PageResult([{ a: 1 }], { page: 1, limit: 20, total: 1, totalPages: 1 });
    await expect(run(page, context())).resolves.toEqual({
      data: [{ a: 1 }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it('leaves 204 responses untouched', async () => {
    await expect(run(undefined, context({ statusCode: 204 }))).resolves.toBeUndefined();
  });

  it('leaves routes marked @SkipEnvelope untouched', async () => {
    await expect(run({ status: 'ok' }, context({ skip: true }))).resolves.toEqual({ status: 'ok' });
  });

  it('ignores non-HTTP contexts', async () => {
    await expect(run({ x: 1 }, context({ type: 'rpc' }))).resolves.toEqual({ x: 1 });
  });
});
