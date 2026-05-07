import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { Prisma, SpedJobStatus } from '@prisma/client';
import { PrismaService } from '@app/database';
import { StorageService } from '@app/storage';
import {
  generateSpedEfd,
  toSpedInvoice,
  type SpedTenant,
  type TaxRegime,
} from '@app/fiscal-core';

interface SpedJobData {
  jobId: string;
}

const SPED_QUEUE = 'sped-jobs';
const WEBHOOK_QUEUE = 'webhook-deliveries';

/**
 * Generates the EFD-ICMS/IPI text file for a given tenant + month. Pulls
 * authorized + cancelled invoices for the period from Postgres, projects
 * them through the SPED adapter and runs the migrated generator. Writes
 * the .txt file to storage and enqueues a `sped.ready` webhook.
 *
 * Purchase notes (received NF-e) come from a future Manifestação flow that
 * isn't ported yet — for now they're empty, which is fine for tenants that
 * only emit (most NFC-e merchants).
 */
@Processor(SPED_QUEUE)
export class SpedProcessor extends WorkerHost {
  private readonly logger = new Logger(SpedProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<SpedJobData>): Promise<void> {
    const spedJob = await this.prisma.asPrivileged().spedJob.findUnique({
      where: { id: job.data.jobId },
    });
    if (!spedJob || spedJob.status === SpedJobStatus.SUCCEEDED) return;

    const startedAt = new Date();
    await this.prisma.asPrivileged().spedJob.update({
      where: { id: spedJob.id },
      data: { status: SpedJobStatus.RUNNING, startedAt },
    });

    try {
      const [year, month] = spedJob.period.split('-').map(Number);
      const periodStart = new Date(Date.UTC(year, month - 1, 1));
      const periodEnd = new Date(Date.UTC(year, month, 1));

      const invoices = await this.prisma.asPrivileged().invoice.findMany({
        where: {
          tenantId: spedJob.tenantId,
          status: { in: ['AUTHORIZED', 'CANCELLED'] },
          authorizedAt: { gte: periodStart, lt: periodEnd },
        },
        orderBy: { authorizedAt: 'asc' },
      });

      const emitter = spedJob.emitter as unknown as Record<string, string>;
      const tenant: SpedTenant = {
        name: emitter.name,
        cnpj: emitter.cnpj,
        uf: emitter.uf,
        ie: emitter.ie,
        im: emitter.im ?? '',
        codMun: emitter.codMun,
        taxRegime: spedJob.taxRegime as TaxRegime,
        fantasia: emitter.fantasia,
      };

      const text = generateSpedEfd({
        tenant,
        period: { year, month },
        invoices: invoices.map(toSpedInvoice),
        purchaseNotes: [],
      });

      const buf = Buffer.from(text, 'latin1'); // SPED is ISO-8859-1; latin1 ≈ ISO-8859-1 for SPED chars
      const key = `tenants/${spedJob.tenantId}/sped/${spedJob.period}/${spedJob.id}.txt`;
      await this.storage.put(key, buf, 'text/plain; charset=iso-8859-1');

      await this.prisma.asPrivileged().spedJob.update({
        where: { id: spedJob.id },
        data: {
          status: SpedJobStatus.SUCCEEDED,
          finishedAt: new Date(),
          storagePath: key,
          fileSize: buf.byteLength,
          invoiceCount: invoices.length,
          layoutVersion: detectLayout(year),
        },
      });

      await this.dispatchWebhook(spedJob.tenantId, spedJob.id, key, invoices.length);
      this.logger.log(`SPED job ${spedJob.id} done — ${invoices.length} invoices, ${buf.byteLength}b`);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`SPED job ${spedJob.id} failed: ${message}`);
      await this.prisma.asPrivileged().spedJob.update({
        where: { id: spedJob.id },
        data: { status: SpedJobStatus.FAILED, finishedAt: new Date(), errorMessage: message },
      });
      throw err;
    }
  }

  private async dispatchWebhook(
    tenantId: string,
    spedJobId: string,
    storagePath: string,
    invoiceCount: number,
  ): Promise<void> {
    const webhooks = await this.prisma.asPrivileged().webhook.findMany({
      where: { tenantId, active: true, events: { has: 'SPED_READY' } },
    });
    if (webhooks.length === 0) return;
    for (const webhook of webhooks) {
      const delivery = await this.prisma.asPrivileged().webhookDelivery.create({
        data: {
          tenantId,
          webhookId: webhook.id,
          event: 'SPED_READY',
          payload: { spedJobId, storagePath, invoiceCount } as unknown as Prisma.InputJsonValue,
        },
      });
      // Reuse the same queue the API enqueues into. We don't import the queue
      // here — the WebhookProcessor in the same worker process will pick it up.
      await this.webhookQueue.add('deliver', { deliveryId: delivery.id }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      });
    }
  }
}

function detectLayout(year: number): string {
  if (year >= 2026) return '020';
  if (year >= 2025) return '019';
  return '015';
}
