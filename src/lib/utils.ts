import * as crypto from 'crypto';
import * as forge from 'node-forge';

// =====================================================
// CERTIFICATE CACHE
// =====================================================

const CERT_CACHE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

interface ParsedCertCacheEntry {
  data: {
    privateKey: string;
    certificate: string;
    chain: string[];
    notBefore: Date;
    notAfter: Date;
    subject: string;
    serialNumber: string;
  };
  expiresAt: number;
}

const parsedCertCache = new Map<string, ParsedCertCacheEntry>();

/**
 * Creates a cache key from PFX content and password
 */
function getCertCacheKey(pfxBase64: string, password: string): string {
  return crypto
    .createHash('sha256')
    .update(pfxBase64 + password)
    .digest('hex');
}

/**
 * Gets parsed certificate from cache if valid
 */
function getCachedParsedCert(pfxBase64: string, password: string) {
  const key = getCertCacheKey(pfxBase64, password);
  const entry = parsedCertCache.get(key);

  if (!entry) return null;

  // Check if expired
  if (Date.now() > entry.expiresAt) {
    parsedCertCache.delete(key);
    return null;
  }

  // Check if certificate is still valid (not expired)
  if (Date.now() > entry.data.notAfter.getTime()) {
    parsedCertCache.delete(key);
    return null;
  }

  return entry.data;
}

/**
 * Stores parsed certificate in cache
 */
function setCachedParsedCert(
  pfxBase64: string,
  password: string,
  data: ParsedCertCacheEntry['data']
): void {
  const key = getCertCacheKey(pfxBase64, password);
  parsedCertCache.set(key, {
    data,
    expiresAt: Date.now() + CERT_CACHE_TTL_MS,
  });
}

/**
 * Gera código numérico aleatório de 8 dígitos (cNF)
 */
export function gerarCodigoNumerico(): string {
  return String(crypto.randomInt(10000000, 99999999));
}

/**
 * Escapa caracteres especiais XML para evitar injection
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Calcula dígito verificador da chave de acesso (módulo 11)
 */
export function calcularDV(chave43: string): string {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  let idx = 0;

  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += parseInt(chave43[i]) * pesos[idx % pesos.length];
    idx++;
  }

  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return String(dv);
}

/**
 * Monta chave de acesso (44 dígitos)
 * Formato: cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)
 */
export function montarChaveAcesso(params: {
  cUF: string;
  dataEmissao: Date;
  cnpj: string;
  modelo: '55' | '65' | '58';
  serie: string;
  numero: number;
  tipoEmissao: string;
  codigoNumerico: string;
}): string {
  const { cUF, dataEmissao, cnpj, modelo, serie, numero, tipoEmissao, codigoNumerico } = params;

  const aamm = String(dataEmissao.getFullYear()).slice(2) +
    String(dataEmissao.getMonth() + 1).padStart(2, '0');

  const chave43 =
    cUF.padStart(2, '0') +
    aamm +
    cnpj.replace(/\D/g, '').padStart(14, '0') +
    modelo +
    serie.padStart(3, '0') +
    String(numero).padStart(9, '0') +
    tipoEmissao +
    codigoNumerico.padStart(8, '0');

  const dv = calcularDV(chave43);
  return chave43 + dv;
}

/**
 * Código IBGE do UF
 */
export const UF_CODES: Record<string, string> = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29',
  CE: '23', DF: '53', ES: '32', GO: '52', MA: '21',
  MT: '51', MS: '50', MG: '31', PA: '15', PB: '25',
  PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24',
  RS: '43', RO: '11', RR: '14', SC: '42', SP: '35',
  SE: '28', TO: '17',
};

/**
 * Extrai certificado e chave privada de um PFX.
 * Uses in-memory cache with 8-hour TTL to avoid expensive parsing.
 */
export function parsePfx(pfxBase64: string, password: string): {
  privateKey: string;
  certificate: string;
  chain: string[];
  notBefore: Date;
  notAfter: Date;
  subject: string;
  serialNumber: string;
} {
  // Check cache first
  const cached = getCachedParsedCert(pfxBase64, password);
  if (cached) {
    return cached;
  }

  const pfxBuf = Buffer.from(pfxBase64, 'base64');
  const pfxDer = forge.util.createBuffer(pfxBuf.toString('binary'));
  const pkcs12Asn1 = forge.asn1.fromDer(pfxDer);
  const pkcs12 = forge.pkcs12.pkcs12FromAsn1(pkcs12Asn1, password);

  // Extrair chave privada
  const keyBags = pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag];
  if (!keyBag || keyBag.length === 0 || !keyBag[0].key) {
    throw new Error('Chave privada não encontrada no certificado');
  }
  const privateKey = forge.pki.privateKeyToPem(keyBag[0].key);

  // Extrair certificados
  const certBags = pkcs12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag];
  if (!certBag || certBag.length === 0 || !certBag[0].cert) {
    throw new Error('Certificado não encontrado no arquivo PFX');
  }

  const cert = certBag[0].cert;
  const certificate = forge.pki.certificateToPem(cert);

  const chain = certBag.slice(1)
    .filter(b => b.cert)
    .map(b => forge.pki.certificateToPem(b.cert!));

  const result = {
    privateKey,
    certificate,
    chain,
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    subject: cert.subject.getField('CN')?.value || '',
    serialNumber: cert.serialNumber,
  };

  // Store in cache for future requests
  setCachedParsedCert(pfxBase64, password, result);

  return result;
}

/**
 * Extrai o PFX como Buffer para uso em HTTPS agent
 */
export function pfxToBuffer(pfxBase64: string): Buffer {
  return Buffer.from(pfxBase64, 'base64');
}

/**
 * Mapa de offset UTC por UF brasileira
 */
const UF_TIMEZONE_OFFSET: Record<string, { hours: number; label: string }> = {
  AC: { hours: 5, label: '-05:00' },
  AM: { hours: 4, label: '-04:00' },
  MT: { hours: 4, label: '-04:00' },
  MS: { hours: 4, label: '-04:00' },
  RO: { hours: 4, label: '-04:00' },
  RR: { hours: 4, label: '-04:00' },
};
const DEFAULT_OFFSET = { hours: 3, label: '-03:00' };

/**
 * Formata data para padrão SEFAZ com timezone correto por UF
 */
export function formatarDataSefaz(date?: Date, uf?: string): string {
  const d = date || new Date();
  const tz = (uf && UF_TIMEZONE_OFFSET[uf.toUpperCase()]) || DEFAULT_OFFSET;
  const local = new Date(d.getTime() - tz.hours * 60 * 60 * 1000);
  const yyyy = local.getUTCFullYear();
  const MM = String(local.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  const ss = String(local.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}${tz.label}`;
}

/**
 * Formata apenas data YYYY-MM-DD
 */
export function formatarData(date?: Date): string {
  const d = date || new Date();
  return d.toISOString().split('T')[0];
}

/**
 * Formata valor decimal com 2 casas
 */
export function formatarValor(valor: number, casas: number = 2): string {
  return valor.toFixed(casas);
}

/**
 * Gera ID único para lote (timestamp + counter para evitar colisão)
 */
let _loteCounter = 0;
export function gerarIdLote(): string {
  _loteCounter = (_loteCounter + 1) % 1000;
  return String(Date.now() * 1000 + _loteCounter).slice(-15);
}

/**
 * Remove caracteres não numéricos
 */
export function apenasNumeros(str: string): string {
  return str.replace(/\D/g, '');
}
