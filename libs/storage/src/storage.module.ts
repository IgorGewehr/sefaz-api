import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageProvider, StorageService } from './storage.service';
import { LocalStorageProvider } from './providers/local.provider';
import { S3StorageProvider } from './providers/s3.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: StorageProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageProvider => {
        const provider = config.get<string>('STORAGE_PROVIDER', 'local');
        switch (provider) {
          case 'local': {
            const root = config.get<string>('STORAGE_LOCAL_PATH', './.storage');
            const apiUrl = config.get<string>('API_URL', 'http://localhost:3333');
            return new LocalStorageProvider(root, apiUrl);
          }
          case 's3': {
            const bucket = config.get<string>('S3_BUCKET');
            const region = config.get<string>('S3_REGION', 'sa-east-1');
            if (!bucket) throw new Error('S3_BUCKET is required when STORAGE_PROVIDER=s3');
            return new S3StorageProvider({
              bucket,
              region,
              endpoint: config.get<string>('S3_ENDPOINT') || undefined,
              forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
              accessKeyId: config.get<string>('S3_ACCESS_KEY_ID') || undefined,
              secretAccessKey: config.get<string>('S3_SECRET_ACCESS_KEY') || undefined,
            });
          }
          default:
            throw new Error(`Unknown storage provider: ${provider}`);
        }
      },
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
