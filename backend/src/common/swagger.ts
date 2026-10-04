import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

export const API_PREFIX = 'api/v1';
export const DOCS_PATH = 'api/docs';

/** OpenAPI document + Swagger UI at /api/docs (JSON at /api/docs/json). Disabled via SWAGGER_ENABLED=false. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Al-Azhar Park API')
    .setDescription(
      'Public website API (park information, events, restaurants, ticket purchase) and the authenticated portal API ' +
        '(content management, orders, ticket scanning, analytics).\n\n' +
        'All responses use `{ data, meta? }`; errors use `{ error: { code, message, details?, requestId } }`.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  SwaggerModule.setup(DOCS_PATH, app, document, { jsonDocumentUrl: `${DOCS_PATH}/json` });
}
