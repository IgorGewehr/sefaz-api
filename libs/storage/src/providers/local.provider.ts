import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { StorageProvider, StoredObject } from '../storage.service';

/**
 * Filesystem-backed storage. Used in dev + tests. Presigned URLs route through
 * the API's `/internal/storage/:key` endpoint with an HMAC-signed expiration
 * timestamp; the API verifies the signature before streaming the file out.
 */
export class LocalStorageProvider extends StorageProvider {
  private readonly root: string;

  constructor(
    root: string,
    private readonly apiUrl: string,
    private readonly signingKey: Buffer = Buffer.from('local-storage-dev-only', 'utf8'),
  ) {
    super();
    this.root = resolve(root);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    await writeFile(`${path}.meta`, JSON.stringify({ contentType, uploadedAt: new Date().toISOString() }));
    return { key, contentType, size: body.byteLength, uploadedAt: new Date() };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    const path = this.resolveKey(key);
    await Promise.allSettled([unlink(path), unlink(`${path}.meta`)]);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async presignedUrl(key: string, ttlSeconds: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = createHmac('sha256', this.signingKey).update(`${key}.${exp}`).digest('hex');
    const params = new URLSearchParams({ exp: String(exp), sig });
    return `${this.apiUrl}/internal/storage/${encodeURIComponent(key)}?${params.toString()}`;
  }

  /** Verifies a presigned URL signature. Used by the API's storage proxy. */
  verifySignature(key: string, exp: string, sig: string): boolean {
    if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
    const expected = createHmac('sha256', this.signingKey).update(`${key}.${exp}`).digest('hex');
    if (expected.length !== sig.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  }

  /** Used by Terminus health check — verifies the storage root is writable. */
  async stat(): Promise<{ root: string; bytes: number }> {
    const s = await stat(this.root).catch(() => null);
    return { root: this.root, bytes: s?.size ?? 0 };
  }

  private resolveKey(key: string): string {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(`${this.root}/`) && path !== this.root) {
      throw new Error('Key escapes storage root');
    }
    return path;
  }
}
