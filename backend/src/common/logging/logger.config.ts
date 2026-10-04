import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { AppConfigService } from '../../config/app-config.service';
import { resolveRequestId } from '../http/request-id';

/** Fields that must never reach the logs. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.token',
  'req.body.refreshToken',
  '*.password',
  '*.passwordHash',
  '*.token',
];

const QUIET_PATHS = ['/api/v1/health', '/api/v1/health/ready'];

/** Structured JSON logs in production; readable colourised lines in development. */
export function buildLoggerParams(config: AppConfigService): Params {
  const dev = config.get('NODE_ENV') === 'development';
  return {
    pinoHttp: {
      level: config.get('LOG_LEVEL'),
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const id = resolveRequestId(req.headers['x-request-id']);
        res.setHeader('x-request-id', id);
        return id;
      },
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      autoLogging: { ignore: (req: IncomingMessage) => QUIET_PATHS.includes((req.url ?? '').split('?')[0]) },
      customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      ...(dev
        ? { transport: { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } } }
        : {}),
    },
  };
}
