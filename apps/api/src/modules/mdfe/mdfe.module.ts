import { Module } from '@nestjs/common';
import { CertificateModule } from '../certificate/certificate.module';
import { MdfeService } from './mdfe.service';

@Module({
  imports: [CertificateModule],
  providers: [MdfeService],
  exports: [MdfeService],
})
export class MdfeModule {}
