import { ApiExtraModels, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { InvoiceType } from '@prisma/client';

class InvoicePayloadDto {
  // Wide-open object — type-specific validation happens in the dispatched service.
  // Keeping it loose at the gateway level lets us evolve schemas per module
  // without a controller redeploy.
  [key: string]: unknown;
}

@ApiExtraModels(InvoicePayloadDto)
export class CreateInvoiceDto {
  @ApiProperty({ enum: InvoiceType, description: 'Tipo do documento fiscal' })
  @IsEnum(InvoiceType)
  type!: InvoiceType;

  @ApiProperty({ required: false, default: 'HOMOLOGATION', enum: ['PRODUCTION', 'HOMOLOGATION'] })
  @IsOptional()
  @IsString()
  environment?: 'PRODUCTION' | 'HOMOLOGATION';

  @ApiProperty({
    description: 'Type-specific payload — see /v1/{nfe|nfce|nfse|mdfe} schemas',
    type: 'object',
    additionalProperties: true,
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => InvoicePayloadDto)
  payload!: Record<string, unknown>;
}

export class InvoiceResponseDto {
  @ApiProperty()
  id!: string;
  @ApiProperty({ enum: InvoiceType })
  type!: InvoiceType;
  @ApiProperty()
  status!: string;
  @ApiProperty({ required: false })
  accessKey?: string | null;
  @ApiProperty({ required: false })
  protocol?: string | null;
  @ApiProperty({ required: false })
  authorizedAt?: Date | null;
  @ApiProperty()
  createdAt!: Date;
}
