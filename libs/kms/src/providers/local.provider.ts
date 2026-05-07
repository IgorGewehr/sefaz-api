import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { KmsProvider } from '../kms.service';

/**
 * Local KMS — AES-256-GCM with a static master key from env. Suitable for
 * development and tests. The wire format mirrors the EnvelopeEncryptionService
 * format so a real KMS can be swapped without migrating data layout.
 */
export class LocalKmsProvider extends KmsProvider {
  private static readonly IV_LEN = 12;
  private static readonly TAG_LEN = 16;

  constructor(private readonly masterKey: Buffer) {
    super();
    if (masterKey.length !== 32) {
      throw new Error('LocalKmsProvider requires a 32-byte master key');
    }
  }

  async encrypt(plaintext: Buffer): Promise<Buffer> {
    const iv = randomBytes(LocalKmsProvider.IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]);
  }

  async decrypt(ciphertext: Buffer): Promise<Buffer> {
    if (ciphertext.length < LocalKmsProvider.IV_LEN + LocalKmsProvider.TAG_LEN) {
      throw new Error('LocalKmsProvider: ciphertext too short');
    }
    const iv = ciphertext.subarray(0, LocalKmsProvider.IV_LEN);
    const tag = ciphertext.subarray(
      LocalKmsProvider.IV_LEN,
      LocalKmsProvider.IV_LEN + LocalKmsProvider.TAG_LEN,
    );
    const ct = ciphertext.subarray(LocalKmsProvider.IV_LEN + LocalKmsProvider.TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}
