import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppConfigService } from './config/app-config.service';
import { API_PREFIX, DOCS_PATH, setupSwagger } from './common/swagger';

/**
 * Everything that makes the HTTP server what it is. Used by main.ts AND by the end-to-end tests,
 * so the tests exercise exactly the production configuration.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfigService);

  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  const hops = config.get('TRUST_PROXY');
  app.set('trust proxy', hops > 0 ? hops : false);

  // Small bodies only: the API takes JSON forms, not file bodies (uploads use a dedicated route later).
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: false });

  // Security headers. Swagger UI needs inline scripts, so only that path gets a relaxed CSP.
  const strict = helmet();
  const docs = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith(`/${DOCS_PATH}`) ? docs(req, res, next) : strict(req, res, next),
  );

  // CORS: an explicit allow-list of browser origins; never a wildcard.
  const allowed = config.get('CORS_ORIGINS');
  app.enableCors({
    origin: (origin, callback) => callback(null, !origin || allowed.includes(origin)),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id', 'Accept-Language'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED')) setupSwagger(app);
}
