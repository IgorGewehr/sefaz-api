import { randomInt } from 'node:crypto';

const UF_TIMEZONE_OFFSET: Record<string, { hours: number; label: string }> = {
  AC: { hours: 5, label: '-05:00' },
  AM: { hours: 4, label: '-04:00' },
  MT: { hours: 4, label: '-04:00' },
  MS: { hours: 4, label: '-04:00' },
  RO: { hours: 4, label: '-04:00' },
  RR: { hours: 4, label: '-04:00' },
};
const DEFAULT_OFFSET = { hours: 3, label: '-03:00' };

export const UF_CODES: Record<string, string> = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29',
  CE: '23', DF: '53', ES: '32', GO: '52', MA: '21',
  MT: '51', MS: '50', MG: '31', PA: '15', PB: '25',
  PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24',
  RS: '43', RO: '11', RR: '14', SC: '42', SP: '35',
  SE: '28', TO: '17',
};

export function gerarCodigoNumerico(): string {
  return String(randomInt(10000000, 99999999));
}

export function calcularDV(chave43: string): string {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  let idx = 0;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += parseInt(chave43[i], 10) * pesos[idx % pesos.length];
    idx++;
  }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return String(dv);
}

export function montarChaveAcesso(params: {
  cUF: string;
  dataEmissao: Date;
  cnpj: string;
  modelo: '55' | '65' | '58';
  serie: string;
  numero: number;
  tipoEmissao: string;
  codigoNumerico: string;
  uf?: string;
}): string {
  const { cUF, dataEmissao, cnpj, modelo, serie, numero, tipoEmissao, codigoNumerico, uf } = params;
  const tz = (uf && UF_TIMEZONE_OFFSET[uf.toUpperCase()]) || DEFAULT_OFFSET;
  const localMs = dataEmissao.getTime() - tz.hours * 60 * 60 * 1000;
  const local = new Date(localMs);
  const aamm =
    String(local.getUTCFullYear()).slice(2) + String(local.getUTCMonth() + 1).padStart(2, '0');

  const chave43 =
    cUF.padStart(2, '0') +
    aamm +
    cnpj.replace(/\D/g, '').padStart(14, '0') +
    modelo +
    serie.padStart(3, '0') +
    String(numero).padStart(9, '0') +
    tipoEmissao +
    codigoNumerico.padStart(8, '0');

  return chave43 + calcularDV(chave43);
}

export function validarChaveAcesso(chave: string): boolean {
  const d = chave.replace(/\D/g, '');
  if (d.length !== 44) return false;
  return calcularDV(d.slice(0, 43)) === d[43];
}
