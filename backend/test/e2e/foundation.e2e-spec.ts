import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../helpers/app';

const API = '/api/v1';

describe('HTTP foundation (e2e)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  describe('health', () => {
    it('GET /health is a plain liveness probe (not enveloped)', async () => {
      const res = await http().get(`${API}/health`).expect(200);
      expect(res.body).toMatchObject({ status: 'ok' });
      expect(res.body.data).toBeUndefined();
    });

    it('GET /health/ready reports the database as up', async () => {
      const res = await http().get(`${API}/health/ready`).expect(200);
      expect(res.body).toEqual({ status: 'ok', checks: { database: 'up' } });
    });

    it('GET /health/ready returns 503 when the database does not answer', async () => {
      const spy = jest.spyOn(app.get(PrismaService), 'ping').mockResolvedValueOnce(false);
      const res = await http().get(`${API}/health/ready`).expect(503);
      expect(res.body).toEqual({ status: 'unavailable', checks: { database: 'down' } });
      spy.mockRestore();
    });
  });

  describe('response and error format', () => {
    it('wraps successful list responses as { data, meta }', async () => {
      const res = await http().get(`${API}/__probe/page?page=1&limit=2`).expect(200);
      expect(res.body).toEqual({ data: [{ n: 1 }, { n: 2 }], meta: { page: 1, limit: 2, total: 2, totalPages: 1 } });
    });

    it('returns a uniform 404 with a request id that matches the response header', async () => {
      const res = await http().get(`${API}/does-not-exist`).expect(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
      expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    });

    it('echoes a safe caller-supplied X-Request-Id and replaces an unsafe one', async () => {
      const ok = await http().get(`${API}/health`).set('X-Request-Id', 'client-trace-0001').expect(200);
      expect(ok.headers['x-request-id']).toBe('client-trace-0001');

      const bad = await http().get(`${API}/health`).set('X-Request-Id', '<script>alert(1)</script>').expect(200);
      expect(bad.headers['x-request-id']).not.toContain('<');
      expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('renders expected business errors with their own code and details', async () => {
      const res = await http().get(`${API}/__probe/business-error`).expect(409);
      expect(res.body.error).toMatchObject({ code: 'TICKET_ALREADY_USED', details: { gate: 'MAIN' } });
    });

    it('never leaks the cause of an unexpected failure', async () => {
      const res = await http().get(`${API}/__probe/boom`).expect(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
    });
  });

  describe('validation', () => {
    it('rejects a bad query with field-level details', async () => {
      const res = await http().get(`${API}/__probe/page?limit=500`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'limit' })]));
    });

    it('rejects a bad body with field-level details', async () => {
      const res = await http().post(`${API}/__probe/echo`).send({ name: 'x', age: 3 }).expect(400);
      const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
      expect(paths).toEqual(['age', 'name']);
    });

    it('accepts a valid body', async () => {
      const res = await http().post(`${API}/__probe/echo`).send({ name: 'Mona', age: 30 }).expect(201);
      expect(res.body).toEqual({ data: { received: { name: 'Mona', age: 30 } } });
    });

    it('rejects malformed JSON with a 400 in the standard error format', async () => {
      const res = await http().post(`${API}/__probe/echo`).set('Content-Type', 'application/json').send('{ not json').expect(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('rejects a body over the 100 KB limit with 413 in the standard error format', async () => {
      const res = await http()
        .post(`${API}/__probe/echo`)
        .send({ name: 'x'.repeat(200_000), age: 30 })
        .expect(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('security', () => {
    it('sends hardened headers and hides the framework', async () => {
      const res = await http().get(`${API}/health`).expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-frame-options']).toBeDefined();
    });

    it('allows a listed CORS origin, with credentials', async () => {
      const res = await http().get(`${API}/health`).set('Origin', 'http://localhost:5173').expect(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not grant CORS to an unlisted origin', async () => {
      const res = await http().get(`${API}/health`).set('Origin', 'https://evil.example').expect(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('answers a CORS preflight for the headers the website needs', async () => {
      const res = await http()
        .options(`${API}/__probe/echo`)
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,idempotency-key,x-order-token')
        .expect(204);
      expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('idempotency-key');
      // the customer's private order key travels in this header
      expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('x-order-token');
    });
  });

  describe('API documentation', () => {
    it('serves the OpenAPI document with the health routes', async () => {
      const res = await http().get('/api/docs/json').expect(200);
      expect(res.body.openapi).toMatch(/^3\./);
      expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining([`${API}/health`, `${API}/health/ready`]));
    });

    it('serves Swagger UI without the strict CSP that would break it', async () => {
      const res = await http().get('/api/docs').expect(200);
      expect(res.headers['content-security-policy']).toBeUndefined();
    });
  });
});

describe('rate limiting (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ RATE_LIMIT_MAX: '3', RATE_LIMIT_TTL_SECONDS: '60' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('answers 429 RATE_LIMITED with Retry-After once the limit is exceeded', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 3; i++) await request(server).get(`${API}/__probe/page`).expect(200);
    const res = await request(server).get(`${API}/__probe/page`).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('never throttles the health probes', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 8; i++) await request(server).get(`${API}/health`).expect(200);
  });
});
