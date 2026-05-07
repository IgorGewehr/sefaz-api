import { Module } from '@nestjs/common';
import { CertificateModule } from '../certificate/certificate.module';
import { WebhookModule } from '../webhook/webhook.module';
import { NfeService } from './nfe.service';

@Module({
  imports: [CertificateModule, WebhookModule],
  providers: [NfeService],
  exports: [NfeService],
})
export class NfeModule {}
