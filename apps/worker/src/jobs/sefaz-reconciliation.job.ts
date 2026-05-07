import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@app/database';

/**
 * Polls retAutorizacao for invoices stuck in PROCESSING/PENDING. The actual
 * SOAP call is delegated to the NFe orchestration that will be ported next —
 * for now the job just surfaces the backlog so we can monitor it.
 */
@Injectable()
export class SefazReconciliationJob {
  private readonly logger = new Logger(SefazReconciliationJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    const stuck = await this.prisma.asPrivileged().invoice.count({
      where: { status: { in: ['PROCESSING', 'PENDING'] } },
    });
    if (stuck > 0) this.logger.log(`reconciliation: ${stuck} invoice(s) awaiting SEFAZ status`);
  }
}
