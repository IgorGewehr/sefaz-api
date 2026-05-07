import { Injectable } from '@nestjs/common';

/**
 * Provider-agnostic KMS interface. Implementations:
 *   - LocalKmsProvider: AES-256-GCM with a single master key (dev only).
 *   - AwsKmsProvider:   AWS KMS (TODO before production).
 *   - GcpKmsProvider:   Google Cloud KMS (TODO before production).
 *
 * `encrypt`/`decrypt` operate on raw bytes. Wrapped DEKs and small secrets
 * (PFX passwords) round-trip through the same API.
 */
export abstract class KmsProvider {
  abstract encrypt(plaintext: Buffer): Promise<Buffer>;
  abstract decrypt(ciphertext: Buffer): Promise<Buffer>;
  /** Optional health check used by the readiness endpoint. */
  abstract isHealthy(): Promise<boolean>;
}

@Injectable()
export class KmsService {
  constructor(private readonly provider: KmsProvider) {}

  encrypt(plaintext: Buffer): Promise<Buffer> {
    return this.provider.encrypt(plaintext);
  }

  decrypt(ciphertext: Buffer): Promise<Buffer> {
    return this.provider.decrypt(ciphertext);
  }

  isHealthy(): Promise<boolean> {
    return this.provider.isHealthy();
  }
}
