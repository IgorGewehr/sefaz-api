import { SignedXml } from 'xml-crypto';
import { parsePfx } from '../utils';
import type { CertificateData } from '../../types';

/**
 * Assina um XML para envio ao SEFAZ.
 *
 * SEFAZ exige:
 * - Assinatura enveloped (dentro do próprio XML)
 * - Algoritmo RSA-SHA256 (migração de SHA1 para SHA256)
 * - Canonicalização exclusiva (C14N)
 * - Reference aponta para o Id do elemento assinado (ex: infNFe, infMDFe)
 * - X509Certificate incluído no KeyInfo
 */
export function assinarXml(
  xml: string,
  certificado: CertificateData,
  tagId: string, // Ex: 'infNFe', 'infMDFe', 'infEvento', 'infInut'
): string {
  const { privateKey, certificate } = parsePfx(certificado.pfxBase64, certificado.password);

  // Extrair o Id do elemento a ser assinado
  const idRegex = new RegExp(`<${tagId}[^>]*\\s+Id="([^"]+)"`, 'i');
  const idMatch = xml.match(idRegex);
  if (!idMatch) {
    throw new Error(`Elemento ${tagId} com atributo Id não encontrado no XML`);
  }

  // Limpar PEM para incluir no KeyInfo
  const certPem = certificate
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  const sig = new SignedXml({
    privateKey,
    publicCert: certificate,
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    getKeyInfoContent: () => `<X509Data><X509Certificate>${certPem}</X509Certificate></X509Data>`,
  });

  sig.addReference({
    xpath: `//*[@Id='${idMatch[1]}']`,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
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

/**
 * Assina XML de evento (cancelamento, carta de correção, encerramento MDF-e)
 */
export function assinarEvento(
  xml: string,
  certificado: CertificateData,
): string {
  return assinarXml(xml, certificado, 'infEvento');
}

/**
 * Assina XML de inutilização
 */
export function assinarInutilizacao(
  xml: string,
  certificado: CertificateData,
): string {
  return assinarXml(xml, certificado, 'infInut');
}
