import { Module } from '@nestjs/common';
import { CertificateModule } from '../certificate/certificate.module';
import { NfeService } from './nfe.service';

@Module({
  imports: [CertificateModule],
  providers: [NfeService],
  exports: [NfeService],
})
export class NfeModule {}
