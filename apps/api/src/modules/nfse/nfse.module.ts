import { Module } from '@nestjs/common';
import { CertificateModule } from '../certificate/certificate.module';
import { NfseService } from './nfse.service';
import { NfseProviderFactory } from './provider.factory';

@Module({
  imports: [CertificateModule],
  providers: [NfseService, NfseProviderFactory],
  exports: [NfseService],
})
export class NfseModule {}
