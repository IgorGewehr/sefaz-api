import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { Invoice, InvoiceType } from '@prisma/client';
import { PrismaService } from '@app/database';
import { NfeService } from '../nfe/nfe.service';
import { NfceService } from '../nfce/nfce.service';
import { MdfeService } from '../mdfe/mdfe.service';
import { NfseService } from '../nfse/nfse.service';
import { CreateInvoiceDto } from './invoice.dto';

export interface EmitInvoiceContext {
  tenantId: string;
  idempotencyKey?: string;
}

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NfeService)) private readonly nfe: NfeService,
    @Inject(forwardRef(() => NfceService)) private readonly nfce: NfceService,
    @Inject(forwardRef(() => MdfeService)) private readonly mdfe: MdfeService,
    @Inject(forwardRef(() => NfseService)) private readonly nfse: NfseService,
  ) {}

  async emit(ctx: EmitInvoiceContext, dto: CreateInvoiceDto): Promise<Invoice> {
    if (ctx.idempotencyKey) {
      const existing = await this.prisma
        .asPrivileged()
        .invoice.findUnique({
          where: {
            tenantId_idempotencyKey: {
              tenantId: ctx.tenantId,
              idempotencyKey: ctx.idempotencyKey,
            },
          },
        });
      if (existing) return existing;
    }

    switch (dto.type) {
      case InvoiceType.NFE:
        return this.nfe.emit(ctx, dto.payload);
      case InvoiceType.NFCE:
        return this.nfce.emit(ctx, dto.payload);
      case InvoiceType.MDFE:
        return this.mdfe.emit(ctx, dto.payload);
      case InvoiceType.NFSE:
        return this.nfse.emit(ctx, dto.payload);
      default:
        throw new BadRequestException(`Type ${dto.type} not yet supported`);
    }
  }

  async list(tenantId: string, filters: { type?: InvoiceType; status?: string; limit?: number }) {
    return this.prisma.asPrivileged().invoice.findMany({
      where: {
        tenantId,
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit ?? 50,
      select: {
        id: true,
        type: true,
        status: true,
        statusMessage: true,
        accessKey: true,
        protocol: true,
        series: true,
        number: true,
        environment: true,
        authorizedAt: true,
        cancelledAt: true,
        createdAt: true,
      },
    });
  }

  async getById(tenantId: string, id: string): Promise<Invoice> {
    const invoice = await this.prisma.asPrivileged().invoice.findUnique({ where: { id } });
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    return invoice;
  }

  async cancel(
    tenantId: string,
    id: string,
    dto: { reason: string },
  ): Promise<Invoice> {
    const invoice = await this.getById(tenantId, id);
    switch (invoice.type) {
      case InvoiceType.NFE:
        return this.nfe.cancel({ tenantId }, invoice, dto.reason);
      case InvoiceType.NFCE:
        return this.nfce.cancel({ tenantId }, invoice, dto.reason);
      case InvoiceType.MDFE:
        return this.mdfe.cancel({ tenantId }, invoice, dto.reason);
      case InvoiceType.NFSE:
        return this.nfse.cancel({ tenantId }, invoice, dto.reason);
      default:
        throw new BadRequestException(`Cancel not supported for type ${invoice.type}`);
    }
  }

  async correction(
    tenantId: string,
    id: string,
    dto: { correction: string; sequence?: number },
  ): Promise<unknown> {
    const invoice = await this.getById(tenantId, id);
    if (invoice.type !== InvoiceType.NFE) {
      throw new BadRequestException(`Carta de Correção only applies to NF-e (got ${invoice.type})`);
    }
    return this.nfe.cartaCorrecao(
      { tenantId },
      invoice,
      dto.correction,
      dto.sequence ?? 1,
    );
  }

  async close(
    tenantId: string,
    id: string,
    dto: { codigoMunicipio: string; uf: string; dataEncerramento?: string },
  ): Promise<Invoice> {
    const invoice = await this.getById(tenantId, id);
    if (invoice.type !== InvoiceType.MDFE) {
      throw new BadRequestException(`Encerramento only applies to MDF-e (got ${invoice.type})`);
    }
    return this.mdfe.encerrar({ tenantId }, invoice, dto);
  }
}
