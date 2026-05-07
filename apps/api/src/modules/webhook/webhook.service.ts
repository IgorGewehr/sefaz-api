import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Webhook, WebhookEvent } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@app/database';
import { AuditService } from '../audit/audit.service';
import { WEBHOOK_QUEUE } from './webhook.constants';
import { RegisterWebhookDto } from './webhook.dto';

@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue,
  ) {}

  async register(tenantId: string, dto: RegisterWebhookDto): Promise<Webhook> {
    const secret = `whsec_${randomBytes(32).toString('base64url')}`;
    const created = await this.prisma.asPrivileged().webhook.create({
      data: {
        tenantId,
        url: dto.url,
        events: dto.events,
        description: dto.description,
        secret,
      },
    });
    await this.audit.record('WEBHOOK_REGISTER', {
      tenantId,
      resourceId: created.id,
      metadata: { url: dto.url, events: dto.events },
    });
    return created;
  }

  async list(tenantId: string) {
    return this.prisma.asPrivileged().webhook.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(tenantId: string, id: string): Promise<void> {
    const webhook = await this.prisma.asPrivileged().webhook.findUnique({ where: { id } });
    if (!webhook || webhook.tenantId !== tenantId) {
      throw new NotFoundException('Webhook not found');
    }
    await this.prisma.asPrivileged().webhook.update({ where: { id }, data: { active: false } });
  }

  /**
   * Enqueue a webhook delivery for every webhook subscribed to `event`.
   * The actual HTTP POST happens in apps/worker.
   */
  async dispatch(
    tenantId: string,
    event: WebhookEvent,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    const webhooks = await this.prisma.asPrivileged().webhook.findMany({
      where: { tenantId, active: true, events: { has: event } },
    });
    for (const webhook of webhooks) {
      const delivery = await this.prisma.asPrivileged().webhookDelivery.create({
        data: { tenantId, webhookId: webhook.id, event, payload },
      });
      await this.queue.add(
        'deliver',
        { deliveryId: delivery.id },
        {
          attempts: parseInt(process.env.WEBHOOK_MAX_ATTEMPTS ?? '3', 10),
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
    }
  }
}
