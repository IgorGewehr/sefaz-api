import { SignedXml } from 'xml-crypto';
import { parsePfx } from '../utils';
import type { CertificateData } from '../../types';

/**
 * Conjunto de algoritmos de assinatura XML.
 *
 * sha1   — padrão para todos os documentos.
 *          O SVRS (Sefaz Virtual do RS, responsável por RS/SC e outros estados)
 *          rejeita SHA-256 em homologação e produção com erro 225
 *          "Falha no Schema XML (Atributo: Algorithm)" — para NF-e e NFC-e.
 *          SHA-1 ainda é aceito universalmente por todos os autorizadores SEFAZ.
 *
 * sha256 — reservado para ambientes/estados que exijam explicitamente SHA-256.
 *          NT 2016.002 previu SHA-256, mas a adoção é inconsistente entre estados.
 */
const ALGOS = {
  sha256: {
    signature: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    digest:    'http://www.w3.org/2001/04/xmlenc#sha256',
  },
  sha1: {
    signature: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    digest:    'http://www.w3.org/2000/09/xmldsig#sha1',
  },
} as const;

/**
 * Assina um XML para envio ao SEFAZ.
 *
 * SEFAZ exige:
 * - Assinatura enveloped (dentro do próprio XML)
 * - Canonicalização C14N (http://www.w3.org/TR/2001/REC-xml-c14n-20010315)
 * - Reference aponta para o Id do elemento assinado (ex: infNFe, infMDFe)
 * - X509Certificate incluído no KeyInfo
 *
 * @param algo 'sha1' (padrão universal) | 'sha256' (estados que exijam SHA-256)
 */
export function assinarXml(
  xml: string,
  certificado: CertificateData,
  tagId: string, // Ex: 'infNFe', 'infMDFe', 'infEvento', 'infInut'
  algo: 'sha256' | 'sha1' = 'sha1',
): string {
  const { privateKey, certificate } = parsePfx(certificado.pfxBase64, certificado.password);

  // Extrair o id do elemento a ser assinado (suporta 'Id' maiúsculo e 'id' minúsculo)
  const idRegex = new RegExp(`<${tagId}[^>]*\\s+[Ii]d="([^"]+)"`);
  const idMatch = xml.match(idRegex);
  if (!idMatch) {
    throw new Error(`Elemento ${tagId} com atributo Id/id não encontrado no XML`);
  }
  // Detectar qual variante do atributo está no XML (Id ou id)
  const idAttrVariant = new RegExp(`<${tagId}[^>]*\\s+(Id)=`).test(xml) ? 'Id' : 'id';

  // Limpar PEM para incluir no KeyInfo
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
    getKeyInfoContent: () => `<X509Data><X509Certificate>${certPem}</X509Certificate></X509Data>`,
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
