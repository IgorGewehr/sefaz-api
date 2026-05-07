import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { KmsService } from '@app/kms';

/**
 * Envelope encryption for the certificate PFX:
 *
 *   1. Generate a random 32-byte DEK per upload.
 *   2. AES-256-GCM(plaintext, DEK) → ciphertext (we prepend IV, append auth tag).
 *   3. KMS.encrypt(DEK) → EDEK. Store ciphertext + EDEK + KMS-encrypted password.
 *
 * The DEK never touches disk. To use the cert we ask KMS to decrypt the EDEK
 * (in memory only), decrypt the ciphertext, sign, then drop the keys.
 */
@Injectable()
export class EnvelopeEncryptionService {
  constructor(private readonly kms: KmsService) {}

  /**
   * Encrypt arbitrary bytes (typically a PFX) using a fresh DEK.
   * Returns the encrypted payload and the KMS-wrapped DEK.
   */
  async encrypt(plaintext: Buffer): Promise<{ ciphertext: Buffer; edek: Buffer }> {
    const dek = randomBytes(32);
    try {
      const ciphertext = aesGcmEncrypt(dek, plaintext);
      const edek = await this.kms.encrypt(dek);
      return { ciphertext, edek };
    } finally {
      dek.fill(0);
    }
  }

  /**
   * Decrypt ciphertext using the wrapped DEK. The DEK is zeroed before return.
   */
  async decrypt(ciphertext: Buffer, edek: Buffer): Promise<Buffer> {
    const dek = await this.kms.decrypt(edek);
    try {
      return aesGcmDecrypt(dek, ciphertext);
    } finally {
      dek.fill(0);
    }
  }

  /**
   * Encrypt a sensitive small string (the PFX password) directly with the KMS.
   * No DEK indirection because the value is short.
   */
  async encryptString(value: string): Promise<Buffer> {
    return this.kms.encrypt(Buffer.from(value, 'utf8'));
  }

  async decryptString(ciphertext: Buffer): Promise<string> {
    const buf = await this.kms.decrypt(ciphertext);
    try {
      return buf.toString('utf8');
    } finally {
      buf.fill(0);
    }
  }
}

const IV_LEN = 12;
const TAG_LEN = 16;

function aesGcmEncrypt(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function aesGcmDecrypt(key: Buffer, payload: Buffer): Buffer {
  if (payload.length < IV_LEN + TAG_LEN) {
    throw new Error('Ciphertext is shorter than IV+tag — cannot decrypt');
  }
  const iv = payload.subarray(0, IV_LEN);
  const tag = payload.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = payload.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
