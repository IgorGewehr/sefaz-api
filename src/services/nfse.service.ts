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
  // Lote usa o primeiro RPS para resolver o provider.
  // (Fallback antigo de cnpj.slice(0,7) removido: prefixo de CNPJ não tem
  // relação com código IBGE — roteava o lote pro provider errado.)
  const primeiroRps = request.rps?.[0];
  const codigoMunicipio = primeiroRps?.servico?.codigoMunicipioPrestacao
    || primeiroRps?.prestador?.endereco?.codigoMunicipio
    || '';

  const provider = getProvider(codigoMunicipio);
  console.log(`[NFS-e] Lote via ${provider.nome} (${request.rps?.length || 0} RPS)`);

  // O contrato do lote (NfseEnviarLoteRequest) traz o certificado no nível
  // raiz e os RPS sem ele — mandar o item cru fazia TODO lote falhar na
  // validação/parsePfx do provider. Hidrata cada item com o certificado do
  // lote (item explícito tem precedência).
  const hydrate = (rps: typeof request.rps[number]) => ({
    ...rps,
    certificado: rps.certificado ?? request.certificado,
  });

  if (request.rps.length === 1) {
    return provider.emitir(hydrate(request.rps[0]));
  }

  // Lote múltiplo: emite sequencialmente, agregando o resultado de CADA RPS
  // — antes só o primeiro era retornado e, em falha parcial, o cliente não
  // sabia quais notas FORAM emitidas (sem rollback possível).
  const resultados: NfseResponse[] = [];
  for (const rps of request.rps) {
    resultados.push(await provider.emitir(hydrate(rps)));
  }

  const primeiro = resultados[0];
  const todosOk = resultados.every(r => r.success);
  // Falha parcial NÃO pode herdar status/numero/xml do 1º RPS (induzia o
  // cliente a tratar o lote como autorizado) — top-level vira 'rejeitado'
  // e os detalhes por RPS ficam nas mensagens LOTE_RPS_n.
  if (!todosOk) {
    return {
      success: false,
      status: 'rejeitado',
      mensagens: resultados.flatMap((r, i) => [
        {
          codigo: `LOTE_RPS_${i + 1}`,
          mensagem: r.success
            ? `RPS ${i + 1}: emitida${r.numeroNfse ? ` (NFSe ${r.numeroNfse})` : ''}${r.codigoVerificacao ? ` cod ${r.codigoVerificacao}` : ''}`
            : `RPS ${i + 1}: FALHOU — ${r.mensagens?.[0]?.mensagem || r.status}`,
        },
        ...(r.mensagens || []),
      ]),
    };
  }
  return {
    ...primeiro,
    success: todosOk,
    mensagens: resultados.flatMap((r, i) => [
      {
        codigo: `LOTE_RPS_${i + 1}`,
        mensagem: r.success
          ? `RPS ${i + 1}: emitida${r.numeroNfse ? ` (NFSe ${r.numeroNfse})` : ''}${r.codigoVerificacao ? ` cod ${r.codigoVerificacao}` : ''}`
          : `RPS ${i + 1}: FALHOU — ${r.mensagens?.[0]?.mensagem || r.status}`,
      },
      ...(r.mensagens || []),
    ]),
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
