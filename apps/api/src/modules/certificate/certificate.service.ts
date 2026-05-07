import { Injectable, NotFoundException } from '@nestjs/common';
import { Certificate as CertificateRow } from '@prisma/client';
import { PrismaService } from '@app/database';
import { EnvelopeEncryptionService } from '@app/crypto';
import { parsePfx, validarCNPJ } from '@app/fiscal-core';
import {
  CertificateError,
  CertificateExpiredError,
  CertificateMismatchError,
} from '@app/common';
import { AuditService } from '../audit/audit.service';
import { UploadCertificateDto } from './certificate.dto';

export interface DecryptedCertificate {
  pfxBase64: string;
  password: string;
}

@Injectable()
export class CertificateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envelope: EnvelopeEncryptionService,
    private readonly audit: AuditService,
  ) {}

  async upload(tenantId: string, dto: UploadCertificateDto): Promise<CertificateRow> {
    let parsed;
    try {
      parsed = parsePfx(dto.pfxBase64, dto.password);
    } catch (err) {
      throw new CertificateError(
        `Falha ao parsear PFX — verifique a senha. (${(err as Error).message})`,
      );
    }
    const cnpj = (dto.cnpj ?? parsed.cnpj ?? '').replace(/\D/g, '');
    if (!cnpj || !validarCNPJ(cnpj)) {
      throw new CertificateError('CNPJ não detectado/inválido no certificado');
    }
    if (parsed.notAfter < new Date()) {
      throw new CertificateExpiredError(parsed.notAfter);
    }

    const pfxBytes = Buffer.from(dto.pfxBase64, 'base64');
    const { ciphertext, edek } = await this.envelope.encrypt(pfxBytes);
    const encryptedPassword = await this.envelope.encryptString(dto.password);

    const cert = await this.prisma.asPrivileged().certificate.create({
      data: {
        tenantId,
        encryptedPfx: new Uint8Array(ciphertext),
        edek: new Uint8Array(edek),
        encryptedPassword: new Uint8Array(encryptedPassword),
        cnpj,
        subject: parsed.subject,
        issuer: parsed.issuer,
        serialNumber: parsed.serialNumber,
        notBefore: parsed.notBefore,
        expiresAt: parsed.notAfter,
      },
    });

    await this.audit.record('CERT_UPLOAD', {
      tenantId,
      resourceId: cert.id,
      metadata: { cnpj, expiresAt: cert.expiresAt },
    });
    return cert;
  }

  async list(tenantId: string) {
    return this.prisma.asPrivileged().certificate.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        cnpj: true,
        subject: true,
        issuer: true,
        serialNumber: true,
        notBefore: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  async findById(tenantId: string, id: string): Promise<CertificateRow> {
    const cert = await this.prisma.asPrivileged().certificate.findUnique({ where: { id } });
    if (!cert || cert.tenantId !== tenantId || cert.deletedAt) {
      throw new NotFoundException(`Certificate ${id} not found`);
    }
    return cert;
  }

  /**
   * LGPD direito ao esquecimento — destrói os bytes encriptados, mantém a
   * linha (com deletedAt) para audit trail.
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const cert = await this.findById(tenantId, id);
    await this.prisma.asPrivileged().certificate.update({
      where: { id: cert.id },
      data: {
        deletedAt: new Date(),
        encryptedPfx: new Uint8Array(0),
        edek: new Uint8Array(0),
        encryptedPassword: new Uint8Array(0),
      },
    });
    await this.audit.record('CERT_DELETE', {
      tenantId,
      resourceId: cert.id,
      metadata: { cnpj: cert.cnpj },
    });
  }

  /**
   * Decrypt for signing. Returns plain {pfxBase64, password} that callers must
   * not persist or log. Records a CERT_USE_SIGN audit entry on every call.
   */
  async decrypt(
    tenantId: string,
    id: string,
    purpose: { resourceId?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<DecryptedCertificate> {
    const cert = await this.findById(tenantId, id);
    if (cert.expiresAt < new Date()) {
      throw new CertificateExpiredError(cert.expiresAt);
    }

    const pfxBytes = await this.envelope.decrypt(
      Buffer.from(cert.encryptedPfx),
      Buffer.from(cert.edek),
    );
    const password = await this.envelope.decryptString(Buffer.from(cert.encryptedPassword));
    const pfxBase64 = pfxBytes.toString('base64');
    pfxBytes.fill(0);

    await this.audit.record('CERT_USE_SIGN', {
      tenantId,
      resourceId: purpose.resourceId ?? cert.id,
      metadata: { certId: cert.id, ...purpose.metadata },
    });

    return { pfxBase64, password };
  }

  /**
   * Resolves the certificate to use for a given emitter CNPJ (or returns the
   * single active cert when there is only one). Validates CNPJ match.
   */
  async resolveForEmitter(tenantId: string, emitterCnpj: string): Promise<CertificateRow> {
    const cnpj = emitterCnpj.replace(/\D/g, '');
    const matches = await this.prisma.asPrivileged().certificate.findMany({
      where: { tenantId, cnpj, deletedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (matches.length > 0) return matches[0];

    const all = await this.prisma.asPrivileged().certificate.findMany({
      where: { tenantId, deletedAt: null, expiresAt: { gt: new Date() } },
    });
    if (all.length === 1) {
      if (all[0].cnpj !== cnpj && process.env.VALIDATE_CERT_CNPJ !== 'false') {
        throw new CertificateMismatchError();
      }
      return all[0];
    }

    throw new NotFoundException(`No active certificate matches emitter CNPJ ${cnpj}`);
  }
}
