import { describe, expect, it, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { EnvelopeEncryptionService } from '../envelope.service';
import { LocalKmsProvider } from '@app/kms';
import { KmsService } from '@app/kms';

describe('EnvelopeEncryptionService', () => {
  let envelope: EnvelopeEncryptionService;

  beforeEach(() => {
    const provider = new LocalKmsProvider(randomBytes(32));
    const kms = new KmsService(provider);
    envelope = new EnvelopeEncryptionService(kms);
  });

  it('round-trips bytes through KMS-wrapped DEK', async () => {
    const plaintext = Buffer.from('certificado-secreto-de-teste'.repeat(100), 'utf8');
    const { ciphertext, edek } = await envelope.encrypt(plaintext);
    expect(ciphertext.equals(plaintext)).toBe(false);
    const decrypted = await envelope.decrypt(ciphertext, edek);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('round-trips a string through KMS directly', async () => {
    const password = 'p@ssw0rd!';
    const ct = await envelope.encryptString(password);
    expect(await envelope.decryptString(ct)).toBe(password);
  });

  it('rejects truncated ciphertext', async () => {
    const plaintext = Buffer.from('hi');
    const { ciphertext, edek } = await envelope.encrypt(plaintext);
    const truncated = ciphertext.subarray(0, 10);
    await expect(envelope.decrypt(truncated, edek)).rejects.toThrow();
  });
});
