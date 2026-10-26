/**
 * "Não chegou à SEFAZ" × "pode ter chegado": o emissor só pode reusar o número (ou ir em
 * contingência com ele) quando o pedido com certeza não saiu — circuito aberto, conexão ou TLS
 * que não se completou, 503, redirecionamento. Um timeout ou queda depois de conectar continua
 * incerto: volta a chave e o XML assinado, para a consulta.
 *
 * O SOAP é real, contra servidores locais (porta fechada, 503, 500).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as https from 'https';
import * as net from 'net';
import { generateKeyPairSync } from 'crypto';
import type { AddressInfo } from 'net';
import * as forge from 'node-forge';
import type { CertificateData, NFCeRequest } from '../../types';
import { enviarSoap, naoChegouASefaz, SefazNaoAlcancadaError } from '../../lib/sefaz/soap-client';

// O servidor de teste usa um certificado próprio.
process.env.SEFAZ_TLS_INSECURE = '1';

function certificadoAutoassinado(cn: string): { chave: string; cert: string; pfx: CertificateData } {
  // 2048 bits: o OpenSSL recusa chave menor num contexto TLS (node-forge é lento para gerar).
  const par = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = {
    privateKey: forge.pki.privateKeyFromPem(par.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()),
    publicKey: forge.pki.publicKeyFromPem(par.publicKey.export({ type: 'spki', format: 'pem' }).toString()),
  };
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [{ name: 'commonName', value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'senha', { algorithm: '3des' });
  return {
    chave: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
    pfx: {
      pfxBase64: Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64'),
      password: 'senha',
    },
  };
}

const cliente = certificadoAutoassinado('EMPRESA TESTE:12345678000195');
const servidorTls = certificadoAutoassinado('localhost');

let servidor: https.Server;
let porta = 0;

beforeAll(async () => {
  servidor = https.createServer({ key: servidorTls.chave, cert: servidorTls.cert }, (req, res) => {
    const status = Number(req.url?.split('/')[1] ?? '200');
    req.resume();
    req.on('end', () => {
      res.writeHead(status, { 'Content-Type': 'text/plain' });
      res.end(`status ${status}`);
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  porta = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((ok) => servidor.close(() => ok()));
});

/** Uma porta que ninguém escuta. */
async function portaFechada(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const p = (s.address() as AddressInfo).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return p;
}

async function erroDe(url: string): Promise<unknown> {
  try {
    await enviarSoap(url, 'acao', '<x/>', cliente.pfx);
  } catch (e) {
    return e;
  }
  throw new Error('deveria ter falhado');
}

describe('enviarSoap: o pedido chegou ou não à SEFAZ', () => {
  it('conexão recusada: não chegou', async () => {
    const e = await erroDe(`https://127.0.0.1:${await portaFechada()}/ws`);
    expect(e).toBeInstanceOf(SefazNaoAlcancadaError);
    expect(naoChegouASefaz(e)).toBe(true);
    expect((e as Error).message).toContain('Erro de conexão com SEFAZ');
  });

  it('503 (serviço fora): não chegou', async () => {
    const e = await erroDe(`https://127.0.0.1:${porta}/503`);
    expect(naoChegouASefaz(e)).toBe(true);
    expect((e as Error).message).toContain('status 503');
  });

  it('500 e 504 podem vir depois de processar: incerto', async () => {
    for (const status of [500, 504]) {
      const e = await erroDe(`https://127.0.0.1:${porta}/${status}`);
      expect(naoChegouASefaz(e)).toBe(false);
      expect((e as Error).message).toContain(`status ${status}`);
    }
  });

  it('o erro serializado (de outro processo) ainda se reconhece', () => {
    expect(naoChegouASefaz({ naoEnviado: true })).toBe(true);
    expect(naoChegouASefaz(new Error('socket hang up'))).toBe(false);
    expect(naoChegouASefaz(undefined)).toBe(false);
  });
});

describe('emitirNFCe: o que não chegou volta sem chave', () => {
  it('sem conexão: naoEnviado, sem chave nem XML assinado; queda depois de conectar: chave para consultar', async () => {
    const { emitirNFCe } = await import('../../services/nfe.service');
    const { getNFCeEndpoints } = await import('../../lib/sefaz/endpoints');
    const original = getNFCeEndpoints('SP', 'homologacao');
    const fechada = await portaFechada();
    const nota = (): NFCeRequest =>
      ({
        emitente: {
          cnpj: '12345678000195',
          nome: 'EMPRESA TESTE LTDA',
          inscricaoEstadual: '123456789012',
          crt: '1',
          endereco: {
            logradouro: 'RUA TESTE',
            numero: '1',
            bairro: 'CENTRO',
            codigoMunicipio: '3550308',
            municipio: 'SAO PAULO',
            uf: 'SP',
            cep: '01001000',
          },
        },
        itens: [
          {
            numero: 1,
            produto: {
              codigo: 'P001',
              cEAN: 'SEM GTIN',
              descricao: 'PRODUTO TESTE',
              ncm: '21069090',
              cfop: '5102',
              unidade: 'UN',
              quantidade: 1,
              valorUnitario: 10,
              valorTotal: 10,
              cEANTrib: 'SEM GTIN',
              unidadeTrib: 'UN',
              quantidadeTrib: 1,
              valorUnitarioTrib: 10,
              indTot: '1',
            },
            imposto: { icms: { orig: '0', csosn: '102' }, pis: { cst: '49' }, cofins: { cst: '49' } },
          },
        ],
        pagamento: { indicadorPagamento: '0', formas: [{ tipo: '01', valor: 10 }] },
        transporte: { modFrete: '9' },
        csc: { id: '000001', token: 'A1B2C3D4-E5F6-A7B8-C9D0-E1F2A3B4C5D6' },
        certificado: cliente.pfx,
        ambiente: 'homologacao',
        serie: '1',
        numero: 7,
        ufEmitente: 'SP',
      }) as unknown as NFCeRequest;

    // O endereço do webservice vem da tabela de endpoints: aponta-se para os servidores locais.
    const trocar = (url: string) => {
      (original as { autorizacao: string }).autorizacao = url;
    };
    const autorizacao = original.autorizacao;
    try {
      trocar(`https://127.0.0.1:${fechada}/ws`);
      const semConexao = await emitirNFCe(nota());
      expect(semConexao.status).toBe('erro');
      expect(semConexao.naoEnviado).toBe(true);
      expect(semConexao.chaveAcesso).toBeUndefined();
      expect(semConexao.xmlAssinado).toBeUndefined();

      trocar(`https://127.0.0.1:${porta}/500`);
      const incerta = await emitirNFCe(nota());
      expect(incerta.naoEnviado).toBeUndefined();
      expect(incerta.chaveAcesso).toMatch(/^\d{44}$/);
      expect(incerta.xmlAssinado).toContain(`Id="NFe${incerta.chaveAcesso}"`);
    } finally {
      trocar(autorizacao);
    }
  });
});
