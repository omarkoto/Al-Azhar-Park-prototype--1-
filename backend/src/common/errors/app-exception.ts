import { HttpException, HttpStatus } from '@nestjs/common';

/** Stable, machine-readable error codes. Clients switch on these; messages are for humans. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNPROCESSABLE: 'UNPROCESSABLE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode] | (string & {});

/**
 * Throw this from services for expected business errors, e.g.
 *   throw new AppException('TICKET_ALREADY_USED', 'This ticket has already been used.', 409, { usedAt })
 * Domain modules define their own codes; the HTTP layer renders them uniformly.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCodeValue,
    message: string,
    status: HttpStatus | number = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}
