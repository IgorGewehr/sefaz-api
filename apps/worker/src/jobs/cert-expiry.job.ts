import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@app/database';

const ALERT_DAYS = [30, 15, 7, 1];

/**
 * Runs daily and emits `certificate.expiring` for any certificate that crosses
 * one of the alert thresholds. The alert dispatch (webhook + email) is wired
 * once the WebhookService is callable from the worker process — for now we
 * just log so operators can see it firing.
 */
@Injectable()
export class CertExpiryJob {
  private readonly logger = new Logger(CertExpiryJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    const now = Date.now();
    const horizon = new Date(now + ALERT_DAYS[0] * 24 * 60 * 60 * 1000);

    const expiring = await this.prisma.asPrivileged().certificate.findMany({
      where: { deletedAt: null, expiresAt: { lte: horizon, gt: new Date() } },
      select: { id: true, tenantId: true, cnpj: true, expiresAt: true },
    });
    if (expiring.length === 0) return;
    this.logger.log(`cert-expiry: ${expiring.length} certificates within ${ALERT_DAYS[0]}d`);
  }
}
