import { Module, forwardRef } from '@nestjs/common';
import { CertificateModule } from '../certificate/certificate.module';
import { NfeModule } from '../nfe/nfe.module';
import { NfceModule } from '../nfce/nfce.module';
import { MdfeModule } from '../mdfe/mdfe.module';
import { NfseModule } from '../nfse/nfse.module';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';

@Module({
  imports: [
    CertificateModule,
    forwardRef(() => NfeModule),
    forwardRef(() => NfceModule),
    forwardRef(() => MdfeModule),
    forwardRef(() => NfseModule),
  ],
  controllers: [InvoiceController],
  providers: [InvoiceService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
