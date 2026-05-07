import { Module } from '@nestjs/common';
import { CertificateModule } from '../certificate/certificate.module';
import { NfceService } from './nfce.service';

@Module({
  imports: [CertificateModule],
  providers: [NfceService],
  exports: [NfceService],
})
export class NfceModule {}
