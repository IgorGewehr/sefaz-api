import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './app/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  if (config.get<string>('HELMET_ENABLED', 'true') !== 'false') {
    app.use(helmet());
  }
  app.enableCors({
    origin: (config.get<string>('CORS_ORIGINS', '') || '').split(',').filter(Boolean),
    credentials: true,
  });

  app.setGlobalPrefix('v1', { exclude: ['health', 'health/(.*)', 'docs', 'docs-json'] });

  if (config.get<string>('SWAGGER_ENABLED', 'true') !== 'false') {
    const builder = new DocumentBuilder()
      .setTitle('Sefaz API')
      .setDescription('Motor fiscal SaaS — NFe, NFCe, NFSe, MDFe, DANFE, SPED.')
      .setVersion('2.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'API key' }, 'apiKey')
      .build();
    const doc = SwaggerModule.createDocument(app, builder);
    SwaggerModule.setup('docs', app, doc, { swaggerOptions: { persistAuthorization: true } });
  }

  app.enableShutdownHooks();

  const port = parseInt(config.get<string>('PORT', '3333'), 10);
  await app.listen(port, '0.0.0.0');
  logger.log(`sefaz-api listening on :${port} (env=${config.get('NODE_ENV')})`);
}

bootstrap();
