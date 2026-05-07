import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@app/common';
import { TenantService } from './tenant.service';
import { RegisterTenantDto } from './tenant.dto';
import { ApiKeyGuard } from '../../app/guards/api-key.guard';
import { Public } from '../../app/guards/public.decorator';

@ApiTags('tenants')
@Controller('tenants')
export class TenantController {
  constructor(private readonly service: TenantService) {}

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cria um tenant e devolve a primeira API key (única vez em plaintext)' })
  register(@Body() dto: RegisterTenantDto) {
    return this.service.register(dto);
  }

  @Get('me')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Retorna os dados do tenant da API key atual' })
  me(@CurrentTenant('tenantId') tenantId: string) {
    return this.service.getById(tenantId);
  }
}
