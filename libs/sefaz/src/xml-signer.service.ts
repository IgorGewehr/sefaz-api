import { Injectable } from '@nestjs/common';
import { SignedXml } from 'xml-crypto';
import { parsePfx } from '@app/fiscal-core';

const ALGOS = {
  sha256: {
    signature: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    digest: 'http://www.w3.org/2001/04/xmlenc#sha256',
  },
  sha1: {
    signature: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    digest: 'http://www.w3.org/2000/09/xmldsig#sha1',
  },
} as const;

export type SignAlgorithm = keyof typeof ALGOS;

/**
 * SEFAZ XML signer migrated from legacy/lib/sefaz/xml-signer.ts. SHA-1 is the
 * universal default — SVRS rejects SHA-256 with code 225.
 *
 * The cert here is decrypted PFX bytes the caller already extracted from KMS.
 * Never accept already-decrypted material outside of a controlled call path.
 */
@Injectable()
export class XmlSignerService {
  signEnvelope(
    xml: string,
    cert: { pfxBase64: string; password: string },
    tagId: string,
    algo: SignAlgorithm = 'sha1',
  ): string {
    const { privateKey, certificate } = parsePfx(cert.pfxBase64, cert.password);

    const idRegex = new RegExp(`<${tagId}[^>]*\\s+[Ii]d="([^"]+)"`);
    const idMatch = xml.match(idRegex);
    if (!idMatch) {
      throw new Error(`Elemento ${tagId} com Id/id não encontrado no XML`);
    }
    const idAttrVariant = new RegExp(`<${tagId}[^>]*\\s+(Id)=`).test(xml) ? 'Id' : 'id';

    const certPem = certificate
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');

    const { signature: signatureAlgorithm, digest: digestAlgorithm } = ALGOS[algo];

    const sig = new SignedXml({
      privateKey,
      publicCert: certificate,
      canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
      signatureAlgorithm,
      getKeyInfoContent: () =>
        `<X509Data><X509Certificate>${certPem}</X509Certificate></X509Data>`,
    });

    sig.addReference({
      xpath: `//*[@${idAttrVariant}='${idMatch[1]}']`,
      digestAlgorithm,
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
      ],
    });

    sig.computeSignature(xml, {
      location: { reference: `//*[local-name(.)='${tagId}']`, action: 'after' },
    });

    return sig.getSignedXml();
  }

  signEvent(xml: string, cert: { pfxBase64: string; password: string }): string {
    return this.signEnvelope(xml, cert, 'infEvento');
  }

  signInutilizacao(xml: string, cert: { pfxBase64: string; password: string }): string {
    return this.signEnvelope(xml, cert, 'infInut');
  }
}
