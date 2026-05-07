import { Module } from '@nestjs/common';
import { CertificateModule } from '../certificate/certificate.module';
import { WebhookModule } from '../webhook/webhook.module';
import { MdfeService } from './mdfe.service';

@Module({
  imports: [CertificateModule, WebhookModule],
  providers: [MdfeService],
  exports: [MdfeService],
})
export class MdfeModule {}
