import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentTenant } from '@app/common';
import { ApiKeyGuard } from '../../app/guards/api-key.guard';
import { SpedService } from './sped.service';
import { CreateSpedJobDto, SpedJobResponseDto } from './sped.dto';

@ApiTags('reports')
@ApiBearerAuth('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('reports')
export class SpedController {
  constructor(private readonly service: SpedService) {}

  @Post('sped')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Dispara um job assíncrono de geração SPED EFD-ICMS/IPI',
    description: 'Retorna o jobId. Polle GET /reports/:jobId até status=SUCCEEDED.',
  })
  async create(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateSpedJobDto,
  ): Promise<SpedJobResponseDto> {
    return toDto(await this.service.enqueue(tenantId, dto));
  }

  @Get()
  @ApiOperation({ summary: 'Lista jobs SPED do tenant' })
  async list(
    @CurrentTenant('tenantId') tenantId: string,
    @Query('period') period?: string,
  ): Promise<SpedJobResponseDto[]> {
    const rows = await this.service.list(tenantId, period);
    return rows.map(toDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Status do job' })
  async get(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ): Promise<SpedJobResponseDto> {
    return toDto(await this.service.get(tenantId, id));
  }

  @Get(':id/download')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({ summary: 'Download do arquivo .txt para entrega à Receita Federal' })
  async download(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, bytes } = await this.service.download(tenantId, id);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(bytes);
  }
}

function toDto(job: {
  id: string;
  status: string;
  period: string;
  invoiceCount: number | null;
  errorMessage: string | null;
  fileSize: number | null;
  layoutVersion: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}): SpedJobResponseDto {
  return {
    id: job.id,
    status: job.status,
    period: job.period,
    invoiceCount: job.invoiceCount ?? undefined,
    errorMessage: job.errorMessage,
    fileSize: job.fileSize,
    layoutVersion: job.layoutVersion,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}
