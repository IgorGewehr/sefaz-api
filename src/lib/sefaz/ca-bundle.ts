// ============================================================
// Bundle de CAs para validação TLS dos webservices fiscais.
//
// Vários autorizadores (SEFAZ estaduais, SEFIN Nacional, Betha) usam
// cadeias ICP-Brasil, cujas raízes NÃO estão no trust store padrão do
// Node. A solução correta é fornecer as raízes via `ca:` — nunca
// desligar a validação com rejectUnauthorized:false (MITM no canal
// que carrega PFX e dados de faturamento).
//
// O bundle combina: raízes padrão do Node (Mozilla) + raízes ICP-Brasil
// (ca/icp-brasil-roots.pem, baixadas do ITI). Os servidores enviam
// as intermediárias no handshake; as raízes bastam como trust anchor.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as tls from 'tls';

let cached: string[] | null = null;

/** Caminho do PEM: env ICP_BRASIL_CA_PATH ou ca/ na raiz do projeto.
 *  NÃO usar certs/: excluído pelo .dockerignore E escondido pelo named
 *  volume certs-data que o compose monta em /app/certs.
 *  (__dirname: src/lib/sefaz em dev, dist/lib/sefaz no build — ../../../
 *  resolve para a raiz nos dois casos.) */
function bundlePath(): string {
  return process.env.ICP_BRASIL_CA_PATH
    || path.join(__dirname, '..', '..', '..', 'ca', 'icp-brasil-roots.pem');
}

export function getCaBundle(): string[] {
  if (cached) return cached;

  let icpRoots: string[] = [];
  try {
    const pem = fs.readFileSync(bundlePath(), 'utf8');
    icpRoots = pem
      .split(/(?=-----BEGIN CERTIFICATE-----)/)
      .filter((c) => c.includes('-----BEGIN CERTIFICATE-----'));
    if (icpRoots.length === 0) {
      console.warn('[ca-bundle] Bundle ICP-Brasil vazio em', bundlePath());
    }
  } catch (err) {
    // Sem o bundle a validação continua LIGADA com as raízes do Node —
    // endpoints com cadeia ICP-Brasil falharão com erro de certificado
    // claro, em vez de aceitar qualquer servidor silenciosamente.
    console.warn(
      `[ca-bundle] Não foi possível ler o bundle ICP-Brasil (${bundlePath()}): ` +
      `${err instanceof Error ? err.message : err}. Usando apenas raízes padrão do Node.`,
    );
  }

  cached = [...tls.rootCertificates, ...icpRoots];
  return cached;
}

/** Escape hatch de emergência (ex.: autorizador com cadeia quebrada em
 *  produção): SEFAZ_TLS_INSECURE=1 desliga a validação. Logado ao usar. */
export function tlsRejectUnauthorized(): boolean {
  if (process.env.SEFAZ_TLS_INSECURE === '1') {
    console.warn('[ca-bundle] ⚠ SEFAZ_TLS_INSECURE=1 — validação TLS DESLIGADA');
    return false;
  }
  return true;
}
