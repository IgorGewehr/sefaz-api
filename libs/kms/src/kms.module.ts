import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KmsProvider, KmsService } from './kms.service';
import { LocalKmsProvider } from './providers/local.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: KmsProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService): KmsProvider => {
        const provider = config.get<string>('KMS_PROVIDER', 'local');
        switch (provider) {
          case 'local': {
            const masterKey = config.get<string>('KMS_LOCAL_MASTER_KEY');
            if (!masterKey || masterKey.length !== 64) {
              throw new Error(
                'KMS_LOCAL_MASTER_KEY must be 64 hex chars (32 bytes). Generate: openssl rand -hex 32',
              );
            }
            return new LocalKmsProvider(Buffer.from(masterKey, 'hex'));
          }
          case 'aws':
          case 'gcp':
            throw new Error(`KMS provider '${provider}' is not yet implemented`);
          default:
            throw new Error(`Unknown KMS provider: ${provider}`);
        }
      },
    },
    KmsService,
  ],
  exports: [KmsService],
})
export class KmsModule {}
