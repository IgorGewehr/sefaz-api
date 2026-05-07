import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { StorageProvider, StoredObject } from '../storage.service';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * S3-compatible storage. Works against AWS S3, Cloudflare R2, MinIO, GCS-S3
 * interoperability mode, and LocalStack — flip `endpoint` + `forcePathStyle`
 * for the non-AWS targets. Credentials fall back to the standard provider
 * chain (env vars, EKS/IRSA, IMDS, ...) when not passed explicitly so prod
 * pods can use IAM roles.
 */
export class S3StorageProvider extends StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    super();
    if (!config.bucket) throw new Error('S3StorageProvider: bucket is required');
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            }
          : undefined,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
    return { key, contentType, size: body.byteLength, uploadedAt: new Date() };
  }

  async get(key: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!out.Body) throw new Error(`S3 key ${key} returned empty body`);
    return streamToBuffer(out.Body as Readable);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === 'NotFound') return false;
      throw err;
    }
  }

  async presignedUrl(key: string, ttlSeconds: number): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.config.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
