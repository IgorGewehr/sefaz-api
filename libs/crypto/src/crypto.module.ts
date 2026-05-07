import { Global, Module } from '@nestjs/common';
import { KmsModule } from '@app/kms';
import { EnvelopeEncryptionService } from './envelope.service';

@Global()
@Module({
  imports: [KmsModule],
  providers: [EnvelopeEncryptionService],
  exports: [EnvelopeEncryptionService],
})
export class CryptoModule {}
