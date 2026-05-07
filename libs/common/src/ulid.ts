import { ulid } from 'ulid';

const PREFIX_MAP = {
  invoice: 'inv',
  certificate: 'crt',
  tenant: 'tnt',
  apikey: 'ak',
  webhook: 'wh',
  delivery: 'whd',
  audit: 'aud',
} as const;

export type ResourceKind = keyof typeof PREFIX_MAP;

export function newId(kind: ResourceKind): string {
  return `${PREFIX_MAP[kind]}_${ulid().toLowerCase()}`;
}
