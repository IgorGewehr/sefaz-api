import { Injectable } from '@nestjs/common';

export interface StoredObject {
  key: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
}

export abstract class StorageProvider {
  abstract put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
  abstract presignedUrl(key: string, ttlSeconds: number): Promise<string>;
  abstract exists(key: string): Promise<boolean>;
}

@Injectable()
export class StorageService {
  constructor(private readonly provider: StorageProvider) {}

  put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    return this.provider.put(key, body, contentType);
  }
  get(key: string): Promise<Buffer> {
    return this.provider.get(key);
  }
  delete(key: string): Promise<void> {
    return this.provider.delete(key);
  }
  presignedUrl(key: string, ttlSeconds = 3600): Promise<string> {
    return this.provider.presignedUrl(key, ttlSeconds);
  }
  exists(key: string): Promise<boolean> {
    return this.provider.exists(key);
  }

  /** Convenience helper: builds a key like `tenants/{tenantId}/invoices/{id}/{kind}.{ext}`. */
  static keyFor(parts: {
    tenantId: string;
    invoiceId: string;
    kind: 'xml' | 'signed-xml' | 'cancel-xml' | 'danfe' | 'sped';
  }): string {
    const ext = parts.kind === 'danfe' ? 'pdf' : parts.kind === 'sped' ? 'txt' : 'xml';
    return `tenants/${parts.tenantId}/invoices/${parts.invoiceId}/${parts.kind}.${ext}`;
  }
}
