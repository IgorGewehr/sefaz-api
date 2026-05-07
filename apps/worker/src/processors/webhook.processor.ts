import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { createHmac } from 'node:crypto';
import { PrismaService } from '@app/database';

interface WebhookJobData {
  deliveryId: string;
}

const WEBHOOK_QUEUE = 'webhook-deliveries';

@Processor(WEBHOOK_QUEUE)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const delivery = await this.prisma.asPrivileged().webhookDelivery.findUnique({
      where: { id: job.data.deliveryId },
      include: { webhook: true },
    });
    if (!delivery || !delivery.webhook.active) return;

    const body = JSON.stringify({
      event: delivery.event,
      tenantId: delivery.tenantId,
      timestamp: new Date().toISOString(),
      data: delivery.payload,
    });

    const signature = createHmac('sha256', delivery.webhook.secret).update(body).digest('hex');

    const controller = new AbortController();
    const timeoutMs = parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? '10000', 10);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let responseCode: number | undefined;
    let responseBody: string | undefined;
    let errorMessage: string | undefined;

    try {
      const res = await fetch(delivery.webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'sefaz-api-webhook/2',
          'X-Sefaz-Event': delivery.event,
          'X-Sefaz-Signature': `sha256=${signature}`,
          'X-Sefaz-Delivery': delivery.id,
        },
        body,
        signal: controller.signal,
      });
      responseCode = res.status;
      responseBody = (await res.text()).slice(0, 4000);
      if (!res.ok) throw new Error(`Webhook returned ${res.status}`);

      await this.prisma.asPrivileged().webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SUCCEEDED',
          attempts: { increment: 1 },
          responseCode,
          responseBody,
          deliveredAt: new Date(),
        },
      });
    } catch (err) {
      errorMessage = (err as Error).message;
      await this.prisma.asPrivileged().webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'RETRYING',
          attempts: { increment: 1 },
          responseCode,
          responseBody,
          errorMessage,
        },
      });
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    this.logger.debug(`delivered ${delivery.event} → ${delivery.webhook.url} (${responseCode})`);
  }
}
