import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const port = Number(process.env.MIZUKI_SERVER_PORT ?? 20154);
  await app.listen(port);
  new Logger('Bootstrap').log(`Mizuki-Server: http://localhost:${port}`);
}

void bootstrap();
