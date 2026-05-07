import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUrl } from 'class-validator';
import { WebhookEvent } from '@prisma/client';

export class RegisterWebhookDto {
  @ApiProperty({ example: 'https://my-app.com/webhooks/sefaz' })
  @IsUrl({ require_tld: false, require_protocol: true })
  url!: string;

  @ApiProperty({ enum: WebhookEvent, isArray: true, example: [WebhookEvent.INVOICE_AUTHORIZED] })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(WebhookEvent, { each: true })
  events!: WebhookEvent[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;
}
