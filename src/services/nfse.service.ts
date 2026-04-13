// ============================================================
// NFS-e Service — Orquestrador com Provider Factory
//
// Delega para o provedor correto (Nacional ADN, Betha, etc)
// com base no código IBGE do município do prestador.
// ============================================================

import { getProvider, getProviderName } from '../lib/nfse/provider-factory';
import type {
  NfseEmitirRequest,
  NfseEnviarLoteRequest,
  NfseConsultarLoteRequest,
  NfseConsultarNfseRequest,
  NfseCancelarRequest,
  NfseResponse,
} from '../types/nfse';

// ============================================================
// Emitir NFS-e (RPS único)
// ============================================================

export async function emitirNfse(request: NfseEmitirRequest): Promise<NfseResponse> {
  const codigoMunicipio = request.servico?.codigoMunicipioPrestacao
    || request.prestador?.endereco?.codigoMunicipio
    || '';

  const provider = getProvider(codigoMunicipio);
  console.log(`[NFS-e] Emitindo via ${provider.nome} (município: ${codigoMunicipio})`);

  return provider.emitir(request);
}

// ============================================================
// Enviar Lote de RPS
// ============================================================

export async function enviarLoteRps(request: NfseEnviarLoteRequest): Promise<NfseResponse> {
  // Lote usa o primeiro RPS para resolver o provider
  const primeiroRps = request.rps?.[0];
  const codigoMunicipio = primeiroRps?.servico?.codigoMunicipioPrestacao
    || request.prestador?.cnpj?.slice(0, 7) // fallback (não ideal)
    || '';

  const provider = getProvider(codigoMunicipio);
  console.log(`[NFS-e] Lote via ${provider.nome} (${request.rps?.length || 0} RPS)`);

  // O lote é um wrapper — delega emissão do primeiro RPS
  // Para lote real com polling, seria necessário expandir a interface.
  // Por agora, emite cada RPS individualmente via o provider.
  if (request.rps.length === 1) {
    return provider.emitir(request.rps[0]);
  }

  // Lote múltiplo: emite sequencialmente (pode ser paralelizado depois)
  const resultados: NfseResponse[] = [];
  for (const rps of request.rps) {
    resultados.push(await provider.emitir(rps));
  }

  // Retorna o primeiro resultado (simplificação)
  const primeiro = resultados[0];
  const todosOk = resultados.every(r => r.success);
  return {
    ...primeiro,
    success: todosOk,
    mensagens: resultados.flatMap(r => r.mensagens || []),
  };
}

// ============================================================
// Consultar Lote de RPS
// ============================================================

export async function consultarLoteRps(request: NfseConsultarLoteRequest): Promise<NfseResponse> {
  const codigoMunicipio = request.codigoMunicipio || '';
  const provider = getProvider(codigoMunicipio);
  console.log(`[NFS-e] Consultando lote via ${getProviderName(codigoMunicipio)} (município: ${codigoMunicipio || 'não informado → Nacional'})`);
  return provider.consultar({
    prestador: request.prestador,
    protocolo: request.protocolo,
    certificado: request.certificado,
  } as NfseConsultarNfseRequest);
}

// ============================================================
// Consultar NFS-e
// ============================================================

export async function consultarNfse(request: NfseConsultarNfseRequest): Promise<NfseResponse> {
  const codigoMunicipio = request.codigoMunicipio || '';
  const provider = getProvider(codigoMunicipio);
  console.log(`[NFS-e] Consultando via ${getProviderName(codigoMunicipio)} (município: ${codigoMunicipio || 'não informado → Nacional'})`);
  return provider.consultar(request);
}

// ============================================================
// Cancelar NFS-e
// ============================================================

export async function cancelarNfse(request: NfseCancelarRequest): Promise<NfseResponse> {
  const codigoMunicipio = request.codigoMunicipio || '';
  const provider = getProvider(codigoMunicipio);
  console.log(`[NFS-e] Cancelando via ${provider.nome} (município: ${codigoMunicipio})`);

  return provider.cancelar(request);
}
