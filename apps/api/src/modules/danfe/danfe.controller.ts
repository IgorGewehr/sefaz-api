import { Controller, Get, Header, Param, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentTenant } from '@app/common';
import { ApiKeyGuard } from '../../app/guards/api-key.guard';
import { DanfeService } from './danfe.service';

@ApiTags('danfe')
@ApiBearerAuth('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('invoices/:id/danfe')
export class DanfeController {
  constructor(private readonly service: DanfeService) {}

  @Get()
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Stream do DANFE em PDF (A4 para NF-e, 80mm para NFC-e)' })
  async render(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.service.render(tenantId, id);
    res.setHeader('Content-Disposition', `inline; filename="danfe-${id}.pdf"`);
    res.send(pdf);
  }
}
