import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { Observable, map } from 'rxjs';
import { ApiSuccess, PageResult, SKIP_ENVELOPE } from '../http/envelope';

/**
 * Wraps every successful response as `{ data, meta? }` so clients parse one shape.
 *   - return a value                → { data: value }
 *   - return new PageResult(items, meta) → { data: items, meta }
 *   - @SkipEnvelope() routes (health, downloads) and 204 responses are left untouched.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE, [context.getHandler(), context.getClass()]);
    if (skip) return next.handle();

    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((result): unknown => {
        if (res.statusCode === 204) return result;
        if (result instanceof PageResult) {
          const body: ApiSuccess<unknown[]> = { data: result.items, meta: result.meta };
          return body;
        }
        const body: ApiSuccess<unknown> = { data: result === undefined ? null : result };
        return body;
      }),
    );
  }
}
