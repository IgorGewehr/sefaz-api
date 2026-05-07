import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@app/common';
import { ApiKeyGuard } from '../../app/guards/api-key.guard';
import { CertificateService } from './certificate.service';
import { CertificateResponse, UploadCertificateDto } from './certificate.dto';

@ApiTags('certificates')
@ApiBearerAuth('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('certificates')
export class CertificateController {
  constructor(private readonly service: CertificateService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Upload de certificado A1 (PFX) com envelope encryption',
    description:
      'O PFX é criptografado com uma DEK por tenant; a DEK é wrapped pelo KMS. ' +
      'O certificado e a senha em texto puro nunca são persistidos.',
  })
  async upload(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: UploadCertificateDto,
  ): Promise<CertificateResponse> {
    const cert = await this.service.upload(tenantId, dto);
    return toResponse(cert);
  }

  @Get()
  @ApiOperation({ summary: 'Lista certificados ativos com alertas de expiração' })
  async list(@CurrentTenant('tenantId') tenantId: string): Promise<CertificateResponse[]> {
    const rows = await this.service.list(tenantId);
    return rows.map(toResponse);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes do certificado' })
  async get(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ): Promise<CertificateResponse> {
    const cert = await this.service.findById(tenantId, id);
    return toResponse(cert);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Direito ao esquecimento (LGPD art. 18)',
    description:
      'Apaga os bytes encriptados (PFX, DEK, senha) e mantém apenas a metadata para audit trail.',
  })
  async delete(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.delete(tenantId, id);
  }
}

function toResponse(cert: {
  id: string;
  cnpj: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: Date;
  expiresAt: Date;
  createdAt: Date;
}): CertificateResponse {
  const now = Date.now();
  const days = Math.ceil((cert.expiresAt.getTime() - now) / (1000 * 60 * 60 * 24));
  return {
    id: cert.id,
    cnpj: cert.cnpj,
    subject: cert.subject,
    issuer: cert.issuer,
    serialNumber: cert.serialNumber,
    notBefore: cert.notBefore,
    expiresAt: cert.expiresAt,
    daysUntilExpiry: days,
    createdAt: cert.createdAt,
  };
}
