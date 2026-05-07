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
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentTenant } from '@app/common';
import { ApiKeyGuard } from '../../app/guards/api-key.guard';
import { ApiKeyService } from './api-key.service';

class IssueApiKeyDto {
  @IsString()
  @MaxLength(80)
  label!: string;

  @IsOptional()
  @IsArray()
  scopes?: string[];
}

@ApiTags('api-keys')
@ApiBearerAuth('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('api-keys')
export class ApiKeyController {
  constructor(private readonly service: ApiKeyService) {}

  @Get()
  @ApiOperation({ summary: 'Lista API keys do tenant atual' })
  list(@CurrentTenant('tenantId') tenantId: string) {
    return this.service.list(tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Gera uma nova API key (plaintext exibido apenas uma vez)' })
  issue(@CurrentTenant('tenantId') tenantId: string, @Body() dto: IssueApiKeyDto) {
    return this.service.issue(tenantId, dto.label, dto.scopes);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga uma API key' })
  async revoke(@CurrentTenant('tenantId') tenantId: string, @Param('id') id: string) {
    await this.service.revoke(tenantId, id);
  }
}
