// ============================================================
// TEST: NFS-e XML Builder + Assinatura SHA-256
//
// Gera um XML de lote RPS com dados fictícios, assina e valida:
//  1. XML bem formado com as tags ABRASF 2.04
//  2. <Signature> inserida DENTRO de <InfDeclaracaoPrestacaoServico>
//  3. DigestMethod e SignatureMethod apontam para SHA-256
//
// Execução: npx tsx scripts/test-nfse-build.ts
// ============================================================

import * as forge from 'node-forge';
import { buildEnviarLoteRpsXml } from '../src/lib/nfse/xml-builder';
import { assinarXml } from '../src/lib/sefaz/xml-signer';
import type { NfseEmitirRequest } from '../src/types/nfse';
import type { CertificateData } from '../src/types';

// ============================================================
// 1. Gerar certificado A1 auto-assinado para testes
// ============================================================

function gerarCertificadoTeste(): CertificateData {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

  const attrs = [
    { name: 'commonName', value: 'EMPRESA TESTE LTDA:00000000000100' },
    { name: 'countryName', value: 'BR' },
    { name: 'stateOrProvinceName', value: 'SP' },
    { name: 'organizationName', value: 'Empresa Teste' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Empacotar como PFX/PKCS#12
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, 'teste123', {
    algorithm: '3des',
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const pfxBase64 = forge.util.encode64(p12Der);

  return { pfxBase64, password: 'teste123' };
}

// ============================================================
// 2. Dados fictícios de RPS
// ============================================================

const mockRps: NfseEmitirRequest = {
  prestador: {
    cnpj: '00.000.000/0001-00',
    inscricaoMunicipal: '12345',
    nome: 'EMPRESA PRESTADORA DE SERVICOS LTDA',
    nomeFantasia: 'Prestadora Tech',
    endereco: {
      logradouro: 'Rua dos Testes',
      numero: '1000',
      complemento: 'Sala 42',
      bairro: 'Centro',
      codigoMunicipio: '3550308', // São Paulo
      uf: 'SP',
      cep: '01001000',
    },
    contato: {
      telefone: '11999998888',
      email: 'fiscal@prestadora.com.br',
    },
    regimeEspecialTributacao: '6', // ME/EPP Simples
    optanteSimplesNacional: true,
    incentivadorCultural: false,
  },
  tomador: {
    cnpj: '11.111.111/0001-11',
    nome: 'EMPRESA TOMADORA S.A.',
    inscricaoMunicipal: '67890',
    endereco: {
      logradouro: 'Av. Paulista',
      numero: '2000',
      bairro: 'Bela Vista',
      codigoMunicipio: '3550308',
      uf: 'SP',
      cep: '01310100',
    },
    contato: {
      email: 'compras@tomadora.com.br',
    },
  },
  servico: {
    codigoServico: '01.07', // Suporte técnico em informática
    cnae: '6204000',
    codigoTributacaoMunicipio: '6204',
    discriminacao: 'Prestação de serviços de desenvolvimento de software customizado conforme contrato 2026/001. Período: março/2026.',
    codigoMunicipioPrestacao: '3550308',
    codigoMunicipioIncidencia: '3550308',
  },
  valores: {
    valorServicos: 15000.00,
    valorDeducoes: 0,
    valorPis: 97.50,     // 0.65%
    valorCofins: 450.00, // 3%
    valorInss: 0,
    valorIr: 225.00,     // 1.5%
    valorCsll: 150.00,   // 1%
    aliquotaIss: 0.05,   // 5% ISS
    exigibilidadeIss: '1', // Exigível
    issRetido: false,
  },
  rps: {
    numero: 1,
    serie: 'RPS',
    tipo: '1',
    dataEmissao: '2026-04-02',
    naturezaOperacao: '1', // Tributação no município
  },
  informacoesComplementares: 'Serviço prestado conforme contrato de desenvolvimento de software.',
  certificado: { pfxBase64: '', password: '' }, // Será preenchido abaixo
};

// ============================================================
// 3. Execução do teste
// ============================================================

function main() {
  console.log('='.repeat(70));
  console.log(' TEST: NFS-e XML Builder + Assinatura SHA-256');
  console.log('='.repeat(70));
  console.log();

  // Gerar certificado de teste
  console.log('[1/5] Gerando certificado A1 auto-assinado para teste...');
  const certificado = gerarCertificadoTeste();
  mockRps.certificado = certificado;
  console.log('      ✓ Certificado gerado com sucesso\n');

  // Build XML do lote
  console.log('[2/5] Construindo XML do lote RPS (ABRASF 2.04)...');
  const xmlLote = buildEnviarLoteRpsXml(
    '202604020001',
    mockRps.prestador.cnpj,
    mockRps.prestador.inscricaoMunicipal,
    [mockRps],
  );
  console.log('      ✓ XML do lote construído\n');

  // Imprimir XML antes da assinatura
  console.log('-'.repeat(70));
  console.log(' XML DO LOTE (antes da assinatura):');
  console.log('-'.repeat(70));
  console.log(formatXml(xmlLote));
  console.log();

  // Assinar
  console.log('[3/5] Assinando <InfDeclaracaoPrestacaoServico> com SHA-256...');
  let xmlAssinado: string;
  try {
    xmlAssinado = assinarXml(xmlLote, certificado, 'InfDeclaracaoPrestacaoServico');
    console.log('      ✓ XML assinado com sucesso\n');
  } catch (err: any) {
    console.error('      ✗ FALHA NA ASSINATURA:', err.message);
    process.exit(1);
  }

  // Imprimir XML assinado
  console.log('-'.repeat(70));
  console.log(' XML ASSINADO:');
  console.log('-'.repeat(70));
  console.log(formatXml(xmlAssinado));
  console.log();

  // ============================================================
  // 4. Validações
  // ============================================================

  console.log('[4/5] Validando posição da <Signature>...');
  const resultados: { nome: string; ok: boolean; detalhe: string }[] = [];

  // 4a. Signature existe
  const hasSignature = xmlAssinado.includes('<Signature');
  resultados.push({
    nome: 'Signature presente no XML',
    ok: hasSignature,
    detalhe: hasSignature ? 'Tag <Signature> encontrada' : 'Tag <Signature> NÃO encontrada',
  });

  // 4b. Signature está DENTRO de InfDeclaracaoPrestacaoServico (enveloped)
  // A <Signature> deve aparecer DEPOIS do conteúdo de InfDecl mas ANTES do fechamento </Rps>
  // Na prática, xml-crypto insere após o elemento referenciado (action: 'after')
  // O que significa que <Signature> vem logo após </InfDeclaracaoPrestacaoServico>
  // dentro do mesmo <Rps>
  const signatureAfterInfDecl = xmlAssinado.includes('</InfDeclaracaoPrestacaoServico><Signature');
  const signatureInsideRps = (() => {
    const sigIdx = xmlAssinado.indexOf('<Signature');
    const rpsCloseIdx = xmlAssinado.indexOf('</Rps>', sigIdx);
    const envelopeCloseIdx = xmlAssinado.indexOf('</EnviarLoteRpsEnvio>', sigIdx);
    // Signature deve estar antes do </Rps> e não solta no final do envelope
    return sigIdx > 0 && rpsCloseIdx > sigIdx && (envelopeCloseIdx === -1 || rpsCloseIdx < envelopeCloseIdx);
  })();

  resultados.push({
    nome: 'Signature posicionada após </InfDeclaracaoPrestacaoServico>',
    ok: signatureAfterInfDecl,
    detalhe: signatureAfterInfDecl
      ? 'Signature corretamente posicionada (enveloped, após a tag assinada)'
      : 'Signature NÃO está na posição esperada',
  });

  resultados.push({
    nome: 'Signature contida dentro do <Rps> (não solta no final)',
    ok: signatureInsideRps,
    detalhe: signatureInsideRps
      ? 'Signature está dentro do escopo do <Rps>'
      : 'Signature está fora do escopo do <Rps>',
  });

  // 4c. SignatureMethod = SHA-256
  const sigMethodSha256 = xmlAssinado.includes('Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"');
  resultados.push({
    nome: 'SignatureMethod = rsa-sha256',
    ok: sigMethodSha256,
    detalhe: sigMethodSha256
      ? 'SignatureMethod aponta para rsa-sha256'
      : 'SignatureMethod NÃO é rsa-sha256 — REGRESSÃO!',
  });

  // 4d. DigestMethod = SHA-256
  const digestMethodSha256 = xmlAssinado.includes('Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"');
  resultados.push({
    nome: 'DigestMethod = sha256',
    ok: digestMethodSha256,
    detalhe: digestMethodSha256
      ? 'DigestMethod aponta para sha256'
      : 'DigestMethod NÃO é sha256 — REGRESSÃO!',
  });

  // 4e. NÃO contém SHA-1 (confirmar que o fix funcionou)
  const noSha1Sig = !xmlAssinado.includes('xmldsig#rsa-sha1');
  const noSha1Digest = !xmlAssinado.includes('xmldsig#sha1');
  resultados.push({
    nome: 'Sem vestígio de SHA-1 (signature)',
    ok: noSha1Sig,
    detalhe: noSha1Sig ? 'Nenhum rsa-sha1 encontrado' : 'ALERTA: rsa-sha1 ainda presente!',
  });
  resultados.push({
    nome: 'Sem vestígio de SHA-1 (digest)',
    ok: noSha1Digest,
    detalhe: noSha1Digest ? 'Nenhum sha1 digest encontrado' : 'ALERTA: sha1 digest ainda presente!',
  });

  // 4f. Reference URI aponta para o Id da InfDeclaracaoPrestacaoServico
  const refUriMatch = xmlAssinado.match(/Reference URI="#([^"]+)"/);
  const expectedId = 'rps_RPS_1';
  const refOk = refUriMatch !== null && refUriMatch[1] === expectedId;
  resultados.push({
    nome: `Reference URI aponta para "${expectedId}"`,
    ok: refOk,
    detalhe: refUriMatch ? `URI="#${refUriMatch[1]}"` : 'Reference URI não encontrada',
  });

  // 4g. X509Certificate presente
  const hasX509 = xmlAssinado.includes('<X509Certificate>') && xmlAssinado.includes('</X509Certificate>');
  resultados.push({
    nome: 'X509Certificate presente no KeyInfo',
    ok: hasX509,
    detalhe: hasX509 ? 'Certificado X509 incluído' : 'X509Certificate ausente',
  });

  // 4h. Tags ABRASF essenciais presentes
  const tagsEssenciais = [
    'EnviarLoteRpsEnvio', 'LoteRps', 'ListaRps', 'Rps',
    'InfDeclaracaoPrestacaoServico', 'IdentificacaoRps',
    'Servico', 'Valores', 'ValorServicos', 'Aliquota', 'BaseCalculo',
    'Prestador', 'Tomador', 'RazaoSocial', 'ItemListaServico',
    'Discriminacao', 'OptanteSimplesNacional',
  ];
  for (const tag of tagsEssenciais) {
    const found = xmlAssinado.includes(`<${tag}`) || xmlAssinado.includes(`:${tag}`);
    resultados.push({
      nome: `Tag ABRASF <${tag}> presente`,
      ok: found,
      detalhe: found ? 'OK' : `Tag <${tag}> NÃO encontrada`,
    });
  }

  // ============================================================
  // 5. Relatório
  // ============================================================

  console.log();
  console.log('[5/5] Relatório de validação:');
  console.log('='.repeat(70));

  let passed = 0;
  let failed = 0;

  for (const r of resultados) {
    const icon = r.ok ? '✓' : '✗';
    const status = r.ok ? 'PASS' : 'FAIL';
    console.log(`  ${icon} [${status}] ${r.nome}`);
    if (!r.ok) {
      console.log(`          → ${r.detalhe}`);
    }
    r.ok ? passed++ : failed++;
  }

  console.log('='.repeat(70));
  console.log(`  Total: ${resultados.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('='.repeat(70));

  if (failed > 0) {
    console.log('\n  ⚠ EXISTEM FALHAS — revisar antes de ir para produção!\n');
    process.exit(1);
  } else {
    console.log('\n  ✓ TODOS OS TESTES PASSARAM — XML e assinatura validados.\n');
    process.exit(0);
  }
}

// ============================================================
// Helper: formatar XML para leitura (indentação simples)
// ============================================================

function formatXml(xml: string): string {
  let formatted = '';
  let indent = 0;
  const parts = xml.replace(/>\s*</g, '><').split(/(<[^>]+>)/);

  for (const part of parts) {
    if (!part.trim()) continue;

    if (part.startsWith('</')) {
      indent = Math.max(0, indent - 1);
      formatted += '  '.repeat(indent) + part + '\n';
    } else if (part.startsWith('<') && !part.startsWith('<?') && !part.endsWith('/>') && !part.includes('</')) {
      formatted += '  '.repeat(indent) + part + '\n';
      if (!part.startsWith('<Signature') && !part.includes('/>')) {
        indent++;
      }
    } else {
      formatted += '  '.repeat(indent) + part + '\n';
    }
  }

  // Truncar se muito longo (manter primeiras e últimas linhas)
  const lines = formatted.split('\n');
  if (lines.length > 120) {
    const head = lines.slice(0, 55).join('\n');
    const tail = lines.slice(-55).join('\n');
    return head + '\n  ... [TRUNCADO: ' + (lines.length - 110) + ' linhas omitidas] ...\n' + tail;
  }

  return formatted;
}

// ============================================================
main();
