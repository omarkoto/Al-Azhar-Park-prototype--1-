import { ArgumentsHost, BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { AppException } from '../errors/app-exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

function setup() {
  const logger = { error: jest.fn() };
  const res = { statusCode: 0, body: undefined as unknown, headersSent: false, getHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: 'req-12345678' }) }),
  } as unknown as ArgumentsHost;
  const filter = new AllExceptionsFilter(logger as never);
  return { filter, host, res, logger };
}

describe('AllExceptionsFilter', () => {
  it('renders AppException with its own code, message and details', () => {
    const { filter, host, res } = setup();
    filter.catch(new AppException('TICKET_ALREADY_USED', 'This ticket has already been used.', 409, { usedAt: 'x' }), host);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'TICKET_ALREADY_USED', message: 'This ticket has already been used.', details: { usedAt: 'x' }, requestId: 'req-12345678' },
    });
  });

  it.each([
    [new NotFoundException('nope'), 404, 'NOT_FOUND'],
    [new UnauthorizedException(), 401, 'UNAUTHENTICATED'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
    [new BadRequestException('bad'), 400, 'BAD_REQUEST'],
    [new ThrottlerException(), 429, 'RATE_LIMITED'],
  ])('maps %# to %i %s', (exception, status, code) => {
    const { filter, host, res } = setup();
    filter.catch(exception, host);
    expect(res.statusCode).toBe(status);
    expect((res.body as { error: { code: string } }).error.code).toBe(code);
  });

  it('turns a Zod validation failure into VALIDATION_FAILED with per-field details', () => {
    const { filter, host, res } = setup();
    const parsed = z.object({ email: z.string().email(), age: z.number().min(18) }).safeParse({ email: 'nope', age: 3 });
    if (parsed.success) throw new Error('expected failure');
    filter.catch(new ZodValidationException(parsed.error), host);
    expect(res.statusCode).toBe(400);
    const body = res.body as { error: { code: string; details: Array<{ path: string }> } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.map((d) => d.path).sort()).toEqual(['age', 'email']);
  });

  it('maps a Prisma unique violation to 409 CONFLICT', () => {
    const { filter, host, res } = setup();
    const error = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['email'] } });
    filter.catch(error, host);
    expect(res.statusCode).toBe(409);
    expect((res.body as { error: { code: string; details: unknown } }).error).toMatchObject({ code: 'CONFLICT', details: { fields: ['email'] } });
  });

  it('maps a Prisma "not found" to 404', () => {
    const { filter, host, res } = setup();
    filter.catch(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 'x' }), host);
    expect(res.statusCode).toBe(404);
  });

  it('handles body-parser style errors that only carry a status', () => {
    const { filter, host, res } = setup();
    filter.catch(Object.assign(new Error('request entity too large'), { status: 413 }), host);
    expect(res.statusCode).toBe(413);
    expect((res.body as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('hides the cause of an unexpected error and logs it with the request id', () => {
    const { filter, host, res, logger } = setup();
    const secret = new Error('connection string postgresql://user:hunter2@db leaked');
    filter.catch(secret, host);
    expect(res.statusCode).toBe(500);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('stack');
    expect((res.body as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR');
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: secret, requestId: 'req-12345678' }), expect.any(String));
  });

  it('does not log expected client errors as errors', () => {
    const { filter, host, logger } = setup();
    filter.catch(new NotFoundException(), host);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does nothing if the response was already sent', () => {
    const { filter, host, res } = setup();
    res.headersSent = true;
    filter.catch(new Error('late'), host);
    expect(res.json).not.toHaveBeenCalled();
  });
});
