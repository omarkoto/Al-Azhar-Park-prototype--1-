import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ZodValidationException } from 'nestjs-zod';
import type { Request, Response } from 'express';
import { AppException, ErrorCode } from '../errors/app-exception';
import { ApiErrorBody } from '../http/envelope';

interface Normalized {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.PAYLOAD_TOO_LARGE,
  422: ErrorCode.UNPROCESSABLE,
  429: ErrorCode.RATE_LIMITED,
  503: ErrorCode.SERVICE_UNAVAILABLE,
};

/**
 * One place that turns every failure into the same JSON shape:
 *   { "error": { "code", "message", "details?", "requestId" } }
 * Expected errors keep their meaning; anything unexpected becomes a generic 500 — the real cause goes to the
 * log (with the request id), never to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { id?: string }>();
    const requestId = (req.id as string | undefined) ?? (res.getHeader?.('x-request-id') as string | undefined);

    const normalized = this.normalize(exception);

    if (normalized.status >= 500) {
      this.logger.error({ err: exception, requestId }, 'Unhandled exception');
    }

    if (res.headersSent) return;
    const body: ApiErrorBody = {
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details !== undefined ? { details: normalized.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
    res.status(normalized.status).json(body);
  }

  private normalize(exception: unknown): Normalized {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof ZodValidationException) {
      const issues = exception.getZodError();
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_FAILED,
        message: 'The request data is invalid.',
        details: (issues as { issues?: Array<{ path: PropertyKey[]; message: string; code: string }> }).issues?.map(
          (i) => ({ path: i.path.map(String).join('.'), message: i.message, code: i.code }),
        ),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      return {
        status,
        code: CODE_BY_STATUS[status] ?? ErrorCode.BAD_REQUEST,
        message: Array.isArray(message) ? message.join('; ') : String(message),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            status: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'A record with the same unique value already exists.',
            details: { fields: (exception.meta?.target as string[] | undefined) ?? undefined },
          };
        case 'P2025':
          return { status: HttpStatus.NOT_FOUND, code: ErrorCode.NOT_FOUND, message: 'The requested record was not found.' };
        case 'P2003':
          return {
            status: HttpStatus.CONFLICT,
            code: ErrorCode.CONFLICT,
            message: 'The record is referenced by other data, or references data that does not exist.',
          };
        default:
          break;
      }
    }

    // Errors raised outside Nest's own types but carrying an HTTP status (e.g. body-parser: 413 / 400)
    const status = (exception as { status?: unknown; statusCode?: unknown } | null)?.status ??
      (exception as { statusCode?: unknown } | null)?.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return {
        status,
        code: CODE_BY_STATUS[status] ?? ErrorCode.BAD_REQUEST,
        message: status === 413 ? 'The request body is too large.' : 'The request could not be processed.',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Something went wrong. Please try again later.',
    };
  }
}
