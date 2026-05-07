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
import { WebhookService } from './webhook.service';
import { RegisterWebhookDto } from './webhook.dto';

@ApiTags('webhooks')
@ApiBearerAuth('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly service: WebhookService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registra webhook (HMAC SHA-256 secret é retornado uma vez)' })
  register(@CurrentTenant('tenantId') tenantId: string, @Body() dto: RegisterWebhookDto) {
    return this.service.register(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista webhooks do tenant' })
  list(@CurrentTenant('tenantId') tenantId: string) {
    return this.service.list(tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desativa um webhook' })
  async delete(@CurrentTenant('tenantId') tenantId: string, @Param('id') id: string) {
    await this.service.revoke(tenantId, id);
  }
}
