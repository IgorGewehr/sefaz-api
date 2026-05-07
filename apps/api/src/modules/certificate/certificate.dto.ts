import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UploadCertificateDto {
  @ApiProperty({
    description: 'PFX file (PKCS#12) base64-encoded',
    example: 'MIIJ...AgIIA==',
  })
  @IsString()
  @IsBase64()
  pfxBase64!: string;

  @ApiProperty({ description: 'PFX password' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;

  @ApiProperty({
    description: 'Optional CNPJ override — by default the CNPJ is parsed from the certificate SAN',
    required: false,
    example: '12345678000195',
  })
  @IsOptional()
  @Matches(/^\d{14}$/)
  cnpj?: string;
}

export class CertificateResponse {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  cnpj!: string;
  @ApiProperty()
  subject!: string;
  @ApiProperty()
  issuer!: string;
  @ApiProperty()
  serialNumber!: string;
  @ApiProperty()
  notBefore!: Date;
  @ApiProperty()
  expiresAt!: Date;
  @ApiProperty()
  daysUntilExpiry!: number;
  @ApiProperty()
  createdAt!: Date;
}
