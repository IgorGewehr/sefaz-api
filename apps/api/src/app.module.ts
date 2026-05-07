import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { TerminusModule } from '@nestjs/terminus';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';

import { CommonModule } from '@app/common';
import { PrismaModule } from '@app/database';
import { KmsModule } from '@app/kms';
import { CryptoModule } from '@app/crypto';
import { StorageModule } from '@app/storage';
import { SefazModule } from '@app/sefaz';

import { TenantContextInterceptor } from './app/interceptors/tenant-context.interceptor';
import { HealthController } from './app/health.controller';

import { AuditModule } from './modules/audit/audit.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { ApiKeyModule } from './modules/api-key/api-key.module';
import { CertificateModule } from './modules/certificate/certificate.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { NfeModule } from './modules/nfe/nfe.module';
import { NfceModule } from './modules/nfce/nfce.module';
import { MdfeModule } from './modules/mdfe/mdfe.module';
import { NfseModule } from './modules/nfse/nfse.module';
import { DanfeModule } from './modules/danfe/danfe.module';
import { SpedModule } from './modules/sped/sped.module';
import { StorageProxyModule } from './modules/storage-proxy/storage-proxy.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.THROTTLE_TTL_MS ?? '60000', 10),
        limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
      },
    ]),
    TerminusModule,
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      },
    }),

    // Shared libs
    CommonModule,
    PrismaModule,
    KmsModule,
    CryptoModule,
    StorageModule,
    SefazModule,

    // Feature modules
    AuditModule,
    TenantModule,
    ApiKeyModule,
    CertificateModule,
    WebhookModule,
    InvoiceModule,
    NfeModule,
    NfceModule,
    MdfeModule,
    NfseModule,
    DanfeModule,
    SpedModule,
    StorageProxyModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
