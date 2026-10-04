import 'reflect-metadata';
import './config/bootstrap-env'; // loads backend/.env into process.env — keep this first

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.factory';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  configureApp(app);

  const config = app.get(AppConfigService);
  await app.listen(config.get('PORT'), config.get('HOST'));
  app.get(Logger).log(`API listening on http://${config.get('HOST')}:${config.get('PORT')}/api/v1 (${config.get('NODE_ENV')})`);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
