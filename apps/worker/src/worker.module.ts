import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';

import { CommonModule } from '@app/common';
import { PrismaModule } from '@app/database';
import { KmsModule } from '@app/kms';
import { CryptoModule } from '@app/crypto';
import { StorageModule } from '@app/storage';
import { SefazModule } from '@app/sefaz';

import { WebhookProcessor } from './processors/webhook.processor';
import { SpedProcessor } from './processors/sped.processor';
import { CertExpiryJob } from './jobs/cert-expiry.job';
import { SefazReconciliationJob } from './jobs/sefaz-reconciliation.job';

const WEBHOOK_QUEUE = 'webhook-deliveries';
const SPED_QUEUE = 'sped-jobs';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
    }),
    BullModule.registerQueue({ name: WEBHOOK_QUEUE }, { name: SPED_QUEUE }),

    CommonModule,
    PrismaModule,
    KmsModule,
    CryptoModule,
    StorageModule,
    SefazModule,
  ],
  providers: [WebhookProcessor, SpedProcessor, CertExpiryJob, SefazReconciliationJob],
})
export class WorkerModule {}
