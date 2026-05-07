import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Prisma, SpedJob, SpedJobStatus } from '@prisma/client';
import { PrismaService } from '@app/database';
import { StorageService } from '@app/storage';
import { AuditService } from '../audit/audit.service';
import { SPED_QUEUE } from './sped.constants';
import { CreateSpedJobDto } from './sped.dto';

@Injectable()
export class SpedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @InjectQueue(SPED_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueue(tenantId: string, dto: CreateSpedJobDto): Promise<SpedJob> {
    const period = `${dto.year}-${String(dto.month).padStart(2, '0')}`;
    const job = await this.prisma.asPrivileged().spedJob.create({
      data: {
        tenantId,
        period,
        taxRegime: dto.taxRegime,
        emitter: dto.emitter as unknown as Prisma.InputJsonValue,
        status: SpedJobStatus.QUEUED,
      },
    });
    await this.queue.add(
      'generate',
      { jobId: job.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    await this.audit.record('SPED_GENERATE', {
      tenantId,
      resourceId: job.id,
      metadata: { period, taxRegime: dto.taxRegime },
    });
    return job;
  }

  async get(tenantId: string, id: string): Promise<SpedJob> {
    const job = await this.prisma.asPrivileged().spedJob.findUnique({ where: { id } });
    if (!job || job.tenantId !== tenantId) throw new NotFoundException(`SPED job ${id} not found`);
    return job;
  }

  async list(tenantId: string, period?: string) {
    return this.prisma.asPrivileged().spedJob.findMany({
      where: { tenantId, ...(period ? { period } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async download(tenantId: string, id: string): Promise<{ filename: string; bytes: Buffer }> {
    const job = await this.get(tenantId, id);
    if (job.status !== SpedJobStatus.SUCCEEDED || !job.storagePath) {
      throw new NotFoundException(`SPED job ${id} is not ready (status=${job.status})`);
    }
    const bytes = await this.storage.get(job.storagePath);
    return {
      filename: `sped-efd-${job.period}-${id}.txt`,
      bytes,
    };
  }
}
