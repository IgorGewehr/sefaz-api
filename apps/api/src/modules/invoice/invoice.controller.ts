import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { Invoice, InvoiceType } from '@prisma/client';
import { CurrentTenant, IdempotencyKey } from '@app/common';
import { ApiKeyGuard } from '../../app/guards/api-key.guard';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto, InvoiceResponseDto } from './invoice.dto';

class CancelInvoiceDto {
  @IsString()
  @MinLength(15)
  @MaxLength(255)
  reason!: string;
}

class CorrectionDto {
  @IsString()
  @MinLength(15)
  @MaxLength(1000)
  correction!: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  sequence?: number;
}

class ListInvoicesQuery {
  @IsOptional()
  @IsEnum(InvoiceType)
  type?: InvoiceType;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsInt()
  limit?: number;
}

@ApiTags('invoices')
@ApiBearerAuth('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly service: InvoiceService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Emite NF-e/NFC-e/NFS-e/MDF-e a partir de um payload polimórfico',
    description:
      'O cliente envia `type` + `payload`. A API resolve o módulo correto (NFe, NFCe, etc.), ' +
      'busca o certificado do tenant, assina e transmite ao SEFAZ/prefeitura.',
  })
  async create(
    @CurrentTenant('tenantId') tenantId: string,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Body() dto: CreateInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    const invoice = await this.service.emit({ tenantId, idempotencyKey }, dto);
    return toResponse(invoice);
  }

  @Get()
  @ApiOperation({ summary: 'Lista invoices com filtros' })
  async list(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() q: ListInvoicesQuery,
  ): Promise<InvoiceResponseDto[]> {
    const rows = await this.service.list(tenantId, { type: q.type, status: q.status, limit: q.limit });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      accessKey: r.accessKey,
      protocol: r.protocol,
      authorizedAt: r.authorizedAt,
      createdAt: r.createdAt,
    }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes da invoice' })
  async get(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ): Promise<InvoiceResponseDto> {
    return toResponse(await this.service.getById(tenantId, id));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelamento (envia evento ao SEFAZ ou cancelamento no provedor NFSe)' })
  async cancel(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: CancelInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    return toResponse(await this.service.cancel(tenantId, id, dto));
  }

  @Post(':id/correction')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Carta de Correção (CC-e) — apenas NF-e' })
  async correction(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: CorrectionDto,
  ) {
    return this.service.correction(tenantId, id, dto);
  }
}

function toResponse(i: Invoice): InvoiceResponseDto {
  return {
    id: i.id,
    type: i.type,
    status: i.status,
    accessKey: i.accessKey,
    protocol: i.protocol,
    authorizedAt: i.authorizedAt,
    createdAt: i.createdAt,
  };
}
