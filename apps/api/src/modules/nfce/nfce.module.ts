import { Module } from '@nestjs/common';
import { CertificateModule } from '../certificate/certificate.module';
import { WebhookModule } from '../webhook/webhook.module';
import { NfceService } from './nfce.service';

@Module({
  imports: [CertificateModule, WebhookModule],
  providers: [NfceService],
  exports: [NfceService],
})
export class NfceModule {}
