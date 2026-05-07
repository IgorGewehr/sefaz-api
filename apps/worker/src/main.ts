import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  const logger = new Logger('Worker');
  logger.log('sefaz-api worker started — BullMQ + scheduled jobs running');

  // The HTTP context is unused; processors are bound by the @Processor decorator.
  // We just need the IoC container alive.
  process.on('SIGTERM', async () => {
    logger.log('SIGTERM — shutting down worker');
    await app.close();
    process.exit(0);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
