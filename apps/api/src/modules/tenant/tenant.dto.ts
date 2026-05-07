import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Plan } from '@prisma/client';

export class RegisterTenantDto {
  @ApiProperty({ example: 'Acme Ltda' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'finance@acme.com.br' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: Plan, required: false, default: Plan.FREE })
  @IsOptional()
  @IsEnum(Plan)
  plan?: Plan;
}
