import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import pino from 'pino';
import { AppConfigService } from '../../config/app-config.service';
import { buildLoggerParams, pathOnly, REDACTED_PATHS } from './logger.config';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pinoHttp = require('pino-http') as (options: object, stream: { write: (line: string) => void }) => (req: unknown, res: unknown) => void;

const config = new AppConfigService({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });

/** Sends one request through the real request-logging configuration and returns every line it logged. */
async function logged(method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<string[]> {
  const lines: string[] = [];
  const options = (buildLoggerParams(config) as { pinoHttp: object }).pinoHttp;
  const log = pinoHttp(options, { write: (line) => lines.push(line) });
  const server = createServer((req, res) => {
    log(req, res);
    res.statusCode = 200;
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.end(body);
  });
  await new Promise((resolve) => setTimeout(resolve, 50)); // let the response-finished log line be written
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return lines;
}

describe('pathOnly', () => {
  it.each([
    ['/api/v1/orders?search=mona%40example.com', '/api/v1/orders'],
    ['/api/v1/orders?search=mona@example.com&page=2', '/api/v1/orders'],
    ['/api/v1/users?search=%2B201001234567', '/api/v1/users'],
    ['/api/v1/health', '/api/v1/health'],
    ['/api/v1/orders/#frag?x=1', '/api/v1/orders/'],
    ['/api/v1/orders?', '/api/v1/orders'],
    ['', ''],
  ])('%s -> %s', (url, expected) => {
    expect(pathOnly(url)).toBe(expected);
  });

  it('copes with a missing url', () => {
    expect(pathOnly(undefined)).toBe('');
  });
});

describe('request logging', () => {
  it('does not write search terms (customer e-mail addresses, phone numbers) or any query string to the log', async () => {
    const lines = await logged('GET', '/api/v1/orders?search=mona.hassan%40example.com&phone=%2B201001234567&page=2');
    expect(lines.length).toBeGreaterThan(0);
    const text = lines.join('\n');
    expect(text).not.toContain('mona');
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('201001234567');
    expect(text).not.toContain('search');
    expect(text).not.toContain('page=2');
    expect(text).not.toContain('?');
  });

  it('still logs what is needed to investigate: method, path, status and request id', async () => {
    const lines = await logged('GET', '/api/v1/tickets?search=TKT-ABC', { 'x-request-id': 'req-1234-abcd' });
    const entry = JSON.parse(lines[lines.length - 1]) as { req: { id: string; method: string; url: string }; res: { statusCode: number } };
    expect(entry.req).toEqual({ id: 'req-1234-abcd', method: 'GET', url: '/api/v1/tickets' });
    expect(entry.res.statusCode).toBe(200);
  });

  it('never writes request headers (authorization, cookies, order tokens) or the body', async () => {
    const secrets = ['Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature', 'azp_refresh=refresh-secret-value', 'order-token-secret-value', 'hunter2-the-password', 'AZP1.TKT-ABCDEFGH23.1.signaturesignaturesig'];
    const lines = await logged(
      'POST',
      '/api/v1/auth/login',
      { authorization: secrets[0], cookie: secrets[1], 'x-order-token': secrets[2], 'content-type': 'application/json', 'content-length': '60' },
      JSON.stringify({ email: 'a@b.test', password: secrets[3], qr: secrets[4] }),
    );
    const text = lines.join('\n');
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/authorization|cookie|x-order-token|"headers"|"body"/i);
  });

  it('does not log the health probes', async () => {
    expect(await logged('GET', '/api/v1/health?probe=1')).toEqual([]);
    expect(await logged('GET', '/api/v1/health/ready')).toEqual([]);
  });
});

describe('redaction (defence in depth, in case a secret ever reaches a log call)', () => {
  const secrets = {
    authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
    cookie: 'azp_refresh=refresh-secret-value',
    orderToken: 'order-token-secret-value',
    setCookie: '__Secure-azp_refresh=refresh-secret-value; HttpOnly',
    password: 'hunter2-the-password',
    currentPassword: 'current-password-value',
    newPassword: 'new-password-value',
    token: 'reset-token-secret-value',
    refreshToken: 'refresh-token-secret-value',
    accessToken: 'access-token-secret-value',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$abc$def',
    nestedToken: 'nested-token-secret-value',
  };

  function output(payload: object): string {
    const lines: string[] = [];
    pino({ redact: { paths: REDACTED_PATHS, censor: '[redacted]' } }, { write: (line: string) => lines.push(line) }).info(payload, 'event');
    return lines.join('\n');
  }

  it('replaces every listed field with [redacted]', () => {
    const text = output({
      req: {
        headers: { authorization: secrets.authorization, cookie: secrets.cookie, 'x-order-token': secrets.orderToken },
        body: { password: secrets.password, currentPassword: secrets.currentPassword, newPassword: secrets.newPassword, token: secrets.token, refreshToken: secrets.refreshToken, accessToken: secrets.accessToken },
      },
      res: { headers: { 'set-cookie': secrets.setCookie } },
      user: { password: secrets.password, passwordHash: secrets.passwordHash, token: secrets.nestedToken },
    });
    for (const secret of Object.values(secrets)) expect(text).not.toContain(secret);
    expect(text.match(/\[redacted\]/g)?.length).toBe(13);
  });

  it('leaves ordinary fields alone', () => {
    const text = output({ req: { method: 'GET', url: '/api/v1/orders' }, requestId: 'abc-123' });
    expect(text).toContain('/api/v1/orders');
    expect(text).toContain('abc-123');
    expect(text).not.toContain('[redacted]');
  });
});
