import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageProvider, StorageService } from './storage.service';
import { LocalStorageProvider } from './providers/local.provider';

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
          case 's3':
            throw new Error('S3 storage provider is not yet implemented');
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
