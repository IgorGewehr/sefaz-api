import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { TaxRegime } from '@app/fiscal-core';

class SpedEmitterDto {
  @ApiProperty()
  @IsString()
  @Length(2, 200)
  name!: string;

  @ApiProperty({ example: '12345678000195' })
  @Matches(/^\d{14}$/)
  cnpj!: string;

  @ApiProperty({ example: 'SP' })
  @Matches(/^[A-Z]{2}$/)
  uf!: string;

  @ApiProperty()
  @IsString()
  ie!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  im?: string;

  @ApiProperty({ description: 'Código IBGE do município (7 dígitos)' })
  @Matches(/^\d{7}$/)
  codMun!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  fantasia?: string;
}

export class CreateSpedJobDto {
  @ApiProperty({ description: 'Mês do período (1–12)' })
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  month!: number;

  @ApiProperty({ description: 'Ano do período' })
  @IsInt()
  @Min(2020)
  @Max(2099)
  @Type(() => Number)
  year!: number;

  @ApiProperty({ enum: ['simples_nacional', 'simples_nacional_excesso', 'lucro_presumido', 'lucro_real'] })
  @IsEnum(['simples_nacional', 'simples_nacional_excesso', 'lucro_presumido', 'lucro_real'])
  taxRegime!: TaxRegime;

  @ApiProperty({ type: SpedEmitterDto })
  @IsObject()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => SpedEmitterDto)
  emitter!: SpedEmitterDto;
}

export class SpedJobResponseDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  status!: string;
  @ApiProperty()
  period!: string;
  @ApiProperty({ required: false })
  invoiceCount?: number;
  @ApiProperty({ required: false })
  errorMessage?: string | null;
  @ApiProperty({ required: false })
  fileSize?: number | null;
  @ApiProperty({ required: false })
  layoutVersion?: string | null;
  @ApiProperty()
  createdAt!: Date;
  @ApiProperty({ required: false })
  finishedAt?: Date | null;
}
