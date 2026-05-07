const UF_TIMEZONE_OFFSET: Record<string, { hours: number; label: string }> = {
  AC: { hours: 5, label: '-05:00' },
  AM: { hours: 4, label: '-04:00' },
  MT: { hours: 4, label: '-04:00' },
  MS: { hours: 4, label: '-04:00' },
  RO: { hours: 4, label: '-04:00' },
  RR: { hours: 4, label: '-04:00' },
};
const DEFAULT_OFFSET = { hours: 3, label: '-03:00' };

export function formatarDataSefaz(date?: Date, uf?: string): string {
  const d = date ?? new Date();
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

export function formatarData(date?: Date): string {
  return (date ?? new Date()).toISOString().split('T')[0];
}

export function formatarValor(valor: number, casas = 2): string {
  return valor.toFixed(casas);
}

let _loteCounter = 0;
export function gerarIdLote(): string {
  _loteCounter = (_loteCounter + 1) % 1000;
  return String(Date.now() * 1000 + _loteCounter).slice(-15);
}
