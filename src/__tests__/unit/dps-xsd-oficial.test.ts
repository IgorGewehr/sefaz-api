/**
 * A DPS do padrão nacional (e o pedido de cancelamento) contra os XSD OFICIAIS publicados em
 * gov.br/nfse: o vigente em produção (20260209) e o da NT 009 (produção restrita, 20261020).
 * Usa o xmllint; sem ele na máquina, os testes são pulados com aviso.
 *
 * O TSSerieDPS do vigente traz `^0{0,4}\d{1,5}$` — em XSD `^`/`$` não são âncoras (o validador
 * .NET da Sefin os trata como âncoras; o libxml2, como letras). Só esse padrão é trocado na cópia
 * temporária que valida.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildDpsXmlNacional, buildEventoCancelamentoXml } from '../../lib/nfse/nacional.provider';
import type { NfseEmitirRequest } from '../../types/nfse';

const temXmllint = spawnSync('xmllint', ['--version']).status === 0;
const XSD = path.join(__dirname, '..', 'fixtures', 'nfse-xsd');

function esquemas(pasta: string, destino: string): string {
  const alvo = path.join(destino, pasta);
  fs.mkdirSync(alvo, { recursive: true });
  for (const f of fs.readdirSync(path.join(XSD, pasta))) {
    const texto = fs.readFileSync(path.join(XSD, pasta, f), 'utf-8')
      .replace('value="^0{0,4}\\d{1,5}$"', 'value="0{0,4}\\d{1,5}"');
    fs.writeFileSync(path.join(alvo, f), texto);
  }
  return alvo;
}

function validar(xml: string, pasta: 'vigente' | 'nt009', xsd: string): string | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dps-xsd-'));
  try {
    const arquivo = path.join(dir, 'doc.xml');
    fs.writeFileSync(arquivo, xml);
    execFileSync('xmllint', ['--noout', '--nonet', '--schema', path.join(esquemas(pasta, dir), xsd), arquivo], { stdio: 'pipe' });
    return null;
  } catch (e: any) {
    return String(e.stderr || e.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function requisicao(): NfseEmitirRequest {
  return {
    prestador: {
      cnpj: '11.222.333/0001-81', inscricaoMunicipal: '12345', nome: 'Assistência Teste',
      endereco: { logradouro: 'Rua Sinimbu', numero: '1500', bairro: 'Centro', codigoMunicipio: '4305108', uf: 'RS', cep: '95020-002' },
      optanteSimplesNacional: true,
    },
    tomador: {
      cpf: '529.982.247-25', nome: 'Maria da Silva & Filhos <ME>',
      endereco: { logradouro: 'Rua A', numero: '1', complemento: 'Sala 2', bairro: 'Centro', codigoMunicipio: '4305108', uf: 'RS', cep: '95020-002' },
      contato: { email: 'maria@exemplo.com.br', telefone: '(54) 99999-0000' },
    },
    servico: {
      codigoServico: '14.01', codigoTributacaoNacional: '140101', nbs: '1.0501.10.00',
      discriminacao: 'OS 42 – iPhone 13: troca de tela\r\nGarantia de 90 dias ✅', codigoMunicipioPrestacao: '4305108',
    },
    valores: { valorServicos: 450, descontoIncondicionado: 50, aliquotaIss: 0.06, issRetido: false },
    rps: { numero: 42, serie: '1', tipo: '1', dataEmissao: '2026-11-23' },
    informacoesComplementares: 'Atendimento no balcão',
    certificado: { pfxBase64: 'x', password: 'x' },
    ambiente: 'homologacao',
  } as NfseEmitirRequest;
}

const casos: [string, (r: NfseEmitirRequest) => void][] = [
  ['Simples ME/EPP com tomador completo', () => {}],
  ['MEI', (r) => { r.prestador.mei = true; }],
  ['regime normal com ISS retido e tomador CNPJ', (r) => {
    r.prestador.optanteSimplesNacional = false;
    r.valores.aliquotaIss = 0.025;
    r.valores.issRetido = true;
    r.tomador = { ...r.tomador, cpf: undefined, cnpj: '11.444.777/0001-61' };
  }],
  ['sem tomador identificado', (r) => { r.tomador = { nome: 'Consumidor' }; }],
];

describe.skipIf(!temXmllint)('DPS do padrão nacional contra os XSD oficiais', () => {
  for (const leiaute of ['vigente', 'nt009'] as const) {
    for (const [nome, ajustar] of casos) {
      it(`${nome} — leiaute ${leiaute}`, () => {
        const r = requisicao();
        ajustar(r);
        const xml = buildDpsXmlNacional(r, leiaute);
        expect(validar(xml, leiaute, 'DPS_v1.01.xsd')).toBeNull();
        const outro = leiaute === 'vigente' ? 'nt009' : 'vigente';
        expect(validar(xml, outro, 'DPS_v1.01.xsd'), `o leiaute ${leiaute} não vale no ${outro}`).not.toBeNull();
      });
    }
  }

  it('pedido de cancelamento valida nos dois', () => {
    const xml = buildEventoCancelamentoXml({
      chaveAcesso: '43051082112223330001810000000000004226110123456789',
      documentoAutor: '11222333000181', cMotivo: '9', xMotivo: 'Nota emitida em duplicidade', ambiente: 'homologacao',
    });
    expect(validar(xml, 'vigente', 'pedRegEvento_v1.01.xsd')).toBeNull();
    expect(validar(xml, 'nt009', 'pedRegEvento_v1.01.xsd')).toBeNull();
  });
});

it.skipIf(temXmllint)('aviso: sem xmllint, a DPS não foi validada contra os XSD oficiais', () => {});
