// ============================================================
// WEBSERVICES SEFAZ - URLs por UF e Ambiente
// Referência: https://www.nfe.fazenda.gov.br/portal/webservices.aspx
// ============================================================

type Ambiente = 'producao' | 'homologacao';

interface WebServices {
  autorizacao: string;
  retAutorizacao: string;
  consultaProtocolo: string;
  statusServico: string;
  inutilizacao: string;
  recepcaoEvento: string;
}

// --- NFe (Modelo 55) ---

const NFE_SVRS_PRODUCAO: WebServices = {
  autorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  statusServico: 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  inutilizacao: 'https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
};

const NFE_SVRS_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  statusServico: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  inutilizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
};

// SVAN (Sefaz Virtual Ambiente Nacional) - MA
const NFE_SVAN_PRODUCAO: WebServices = {
  autorizacao: 'https://www.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://www.sefazvirtual.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://www.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
  statusServico: 'https://www.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx',
  inutilizacao: 'https://www.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx',
  recepcaoEvento: 'https://www.sefazvirtual.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};

const NFE_SVAN_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://hom.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://hom.sefazvirtual.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://hom.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
  statusServico: 'https://hom.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx',
  inutilizacao: 'https://hom.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx',
  recepcaoEvento: 'https://hom.sefazvirtual.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};

// Estados com SEFAZ própria
const NFE_SP_PRODUCAO: WebServices = {
  autorizacao: 'https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
  retAutorizacao: 'https://nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx',
  consultaProtocolo: 'https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
  statusServico: 'https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
  inutilizacao: 'https://nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx',
};

const NFE_SP_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
  retAutorizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx',
  consultaProtocolo: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
  statusServico: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
  inutilizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx',
};

const NFE_MG_PRODUCAO: WebServices = {
  autorizacao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
  retAutorizacao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4',
  consultaProtocolo: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
  statusServico: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
  inutilizacao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeInutilizacao4',
  recepcaoEvento: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4',
};

const NFE_MG_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
  retAutorizacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4',
  consultaProtocolo: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
  statusServico: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
  inutilizacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeInutilizacao4',
  recepcaoEvento: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4',
};

const NFE_RS_PRODUCAO: WebServices = {
  autorizacao: 'https://nfe.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://nfe.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://nfe.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  statusServico: 'https://nfe.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  inutilizacao: 'https://nfe.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://nfe.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
};

const NFE_RS_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  statusServico: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  inutilizacao: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
};

const NFE_PR_PRODUCAO: WebServices = {
  autorizacao: 'https://nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4?wsdl',
  retAutorizacao: 'https://nfe.sefa.pr.gov.br/nfe/NFeRetAutorizacao4?wsdl',
  consultaProtocolo: 'https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4?wsdl',
  statusServico: 'https://nfe.sefa.pr.gov.br/nfe/NFeStatusServico4?wsdl',
  inutilizacao: 'https://nfe.sefa.pr.gov.br/nfe/NFeInutilizacao4?wsdl',
  recepcaoEvento: 'https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4?wsdl',
};

const NFE_PR_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4?wsdl',
  retAutorizacao: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRetAutorizacao4?wsdl',
  consultaProtocolo: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4?wsdl',
  statusServico: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeStatusServico4?wsdl',
  inutilizacao: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeInutilizacao4?wsdl',
  recepcaoEvento: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4?wsdl',
};

const NFE_MT_PRODUCAO: WebServices = {
  autorizacao: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4?wsdl',
  retAutorizacao: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeRetAutorizacao4?wsdl',
  consultaProtocolo: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4?wsdl',
  statusServico: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4?wsdl',
  inutilizacao: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4?wsdl',
  recepcaoEvento: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeRecepcaoEvento4?wsdl',
};

const NFE_MT_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4?wsdl',
  retAutorizacao: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeRetAutorizacao4?wsdl',
  consultaProtocolo: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4?wsdl',
  statusServico: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4?wsdl',
  inutilizacao: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4?wsdl',
  recepcaoEvento: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeRecepcaoEvento4?wsdl',
};

const NFE_MS_PRODUCAO: WebServices = {
  autorizacao: 'https://nfe.sefaz.ms.gov.br/ws/NFeAutorizacao4?wsdl',
  retAutorizacao: 'https://nfe.sefaz.ms.gov.br/ws/NFeRetAutorizacao4?wsdl',
  consultaProtocolo: 'https://nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4?wsdl',
  statusServico: 'https://nfe.sefaz.ms.gov.br/ws/NFeStatusServico4?wsdl',
  inutilizacao: 'https://nfe.sefaz.ms.gov.br/ws/NFeInutilizacao4?wsdl',
  recepcaoEvento: 'https://nfe.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4?wsdl',
};

const NFE_MS_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeAutorizacao4?wsdl',
  retAutorizacao: 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeRetAutorizacao4?wsdl',
  consultaProtocolo: 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4?wsdl',
  statusServico: 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeStatusServico4?wsdl',
  inutilizacao: 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeInutilizacao4?wsdl',
  recepcaoEvento: 'https://hom.nfe.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4?wsdl',
};

const NFE_GO_PRODUCAO: WebServices = {
  autorizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4?wsdl',
  retAutorizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4?wsdl',
  consultaProtocolo: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4?wsdl',
  statusServico: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4?wsdl',
  inutilizacao: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4?wsdl',
  recepcaoEvento: 'https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4?wsdl',
};

const NFE_GO_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://homologacao.sefaz.go.gov.br/nfe/services/NFeAutorizacao4?wsdl',
  retAutorizacao: 'https://homologacao.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4?wsdl',
  consultaProtocolo: 'https://homologacao.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4?wsdl',
  statusServico: 'https://homologacao.sefaz.go.gov.br/nfe/services/NFeStatusServico4?wsdl',
  inutilizacao: 'https://homologacao.sefaz.go.gov.br/nfe/services/NFeInutilizacao4?wsdl',
  recepcaoEvento: 'https://homologacao.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4?wsdl',
};

const NFE_BA_PRODUCAO: WebServices = {
  autorizacao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
  statusServico: 'https://nfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx',
  inutilizacao: 'https://nfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx',
  recepcaoEvento: 'https://nfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};

const NFE_BA_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
  statusServico: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx',
  inutilizacao: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx',
  recepcaoEvento: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};

const NFE_PE_PRODUCAO: WebServices = {
  autorizacao: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4?wsdl',
  retAutorizacao: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRetAutorizacao4?wsdl',
  consultaProtocolo: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4?wsdl',
  statusServico: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4?wsdl',
  inutilizacao: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4?wsdl',
  recepcaoEvento: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4?wsdl',
};

const NFE_PE_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4?wsdl',
  retAutorizacao: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRetAutorizacao4?wsdl',
  consultaProtocolo: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4?wsdl',
  statusServico: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4?wsdl',
  inutilizacao: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4?wsdl',
  recepcaoEvento: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4?wsdl',
};

const NFE_AM_PRODUCAO: WebServices = {
  autorizacao: 'https://nfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4',
  retAutorizacao: 'https://nfe.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4',
  consultaProtocolo: 'https://nfe.sefaz.am.gov.br/services2/services/NfeConsulta4',
  statusServico: 'https://nfe.sefaz.am.gov.br/services2/services/NfeStatusServico4',
  inutilizacao: 'https://nfe.sefaz.am.gov.br/services2/services/NfeInutilizacao4',
  recepcaoEvento: 'https://nfe.sefaz.am.gov.br/services2/services/RecepcaoEvento4',
};

const NFE_AM_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4',
  retAutorizacao: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4',
  consultaProtocolo: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeConsulta4',
  statusServico: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeStatusServico4',
  inutilizacao: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeInutilizacao4',
  recepcaoEvento: 'https://homnfe.sefaz.am.gov.br/services2/services/RecepcaoEvento4',
};

// Mapeamento UF → WebServices para NFe
const NFE_ENDPOINTS: Record<string, Record<Ambiente, WebServices>> = {
  // SEFAZ própria
  SP: { producao: NFE_SP_PRODUCAO, homologacao: NFE_SP_HOMOLOGACAO },
  MG: { producao: NFE_MG_PRODUCAO, homologacao: NFE_MG_HOMOLOGACAO },
  RS: { producao: NFE_RS_PRODUCAO, homologacao: NFE_RS_HOMOLOGACAO },
  PR: { producao: NFE_PR_PRODUCAO, homologacao: NFE_PR_HOMOLOGACAO },
  MT: { producao: NFE_MT_PRODUCAO, homologacao: NFE_MT_HOMOLOGACAO },
  MS: { producao: NFE_MS_PRODUCAO, homologacao: NFE_MS_HOMOLOGACAO },
  GO: { producao: NFE_GO_PRODUCAO, homologacao: NFE_GO_HOMOLOGACAO },
  BA: { producao: NFE_BA_PRODUCAO, homologacao: NFE_BA_HOMOLOGACAO },
  PE: { producao: NFE_PE_PRODUCAO, homologacao: NFE_PE_HOMOLOGACAO },
  AM: { producao: NFE_AM_PRODUCAO, homologacao: NFE_AM_HOMOLOGACAO },
  // SVAN
  MA: { producao: NFE_SVAN_PRODUCAO, homologacao: NFE_SVAN_HOMOLOGACAO },
  // SVRS — todos os demais estados
  AC: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  AL: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  AP: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  CE: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  DF: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  ES: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  PA: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  PB: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  PI: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  RJ: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  RN: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  RO: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  RR: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  SC: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  SE: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
  TO: { producao: NFE_SVRS_PRODUCAO, homologacao: NFE_SVRS_HOMOLOGACAO },
};

// --- NFCe (Modelo 65) - Usa SVRS para a maioria ---

const NFCE_SVRS_PRODUCAO: WebServices = {
  autorizacao: 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  statusServico: 'https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  inutilizacao: 'https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
};

const NFCE_SVRS_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  statusServico: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  inutilizacao: 'https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
};

const NFCE_SP_PRODUCAO: WebServices = {
  autorizacao: 'https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
  statusServico: 'https://nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx',
  inutilizacao: 'https://nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx',
  recepcaoEvento: 'https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx',
};

const NFCE_SP_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
  statusServico: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx',
  inutilizacao: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx',
  recepcaoEvento: 'https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx',
};

const NFCE_RS_PRODUCAO: WebServices = {
  autorizacao: 'https://nfce.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://nfce.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://nfce.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  statusServico: 'https://nfce.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  inutilizacao: 'https://nfce.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://nfce.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
};

const NFCE_RS_HOMOLOGACAO: WebServices = {
  autorizacao: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  statusServico: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  inutilizacao: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://nfce-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
};

// Mapeamento NFCe
const NFCE_ENDPOINTS: Record<string, Record<Ambiente, WebServices>> = {
  SP: { producao: NFCE_SP_PRODUCAO, homologacao: NFCE_SP_HOMOLOGACAO },
  RS: { producao: NFCE_RS_PRODUCAO, homologacao: NFCE_RS_HOMOLOGACAO },
  // Demais estados usam SVRS
  ...Object.fromEntries(
    ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
     'PA','PB','PE','PI','PR','RJ','RN','RO','RR','SC','SE','TO'].map(uf => [
      uf,
      { producao: NFCE_SVRS_PRODUCAO, homologacao: NFCE_SVRS_HOMOLOGACAO }
    ])
  ),
};

// --- MDF-e (Modelo 58) - Usa SVRS para todos ---

interface MdfeWebServices {
  recepcao: string; // MDFeRecepcaoSinc (síncrono)
  consulta: string;
  statusServico: string;
  recepcaoEvento: string;
  consultaNaoEnc: string; // Consulta não encerrados
}

const MDFE_SVRS_PRODUCAO: MdfeWebServices = {
  recepcao: 'https://mdfe.svrs.rs.gov.br/ws/MDFeRecepcaoSinc/MDFeRecepcaoSinc.asmx',
  consulta: 'https://mdfe.svrs.rs.gov.br/ws/MDFeConsulta/MDFeConsulta.asmx',
  statusServico: 'https://mdfe.svrs.rs.gov.br/ws/MDFeStatusServico/MDFeStatusServico.asmx',
  recepcaoEvento: 'https://mdfe.svrs.rs.gov.br/ws/MDFeRecepcaoEvento/MDFeRecepcaoEvento.asmx',
  consultaNaoEnc: 'https://mdfe.svrs.rs.gov.br/ws/MDFeConsNaoEnc/MDFeConsNaoEnc.asmx',
};

const MDFE_SVRS_HOMOLOGACAO: MdfeWebServices = {
  recepcao: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRecepcaoSinc/MDFeRecepcaoSinc.asmx',
  consulta: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeConsulta/MDFeConsulta.asmx',
  statusServico: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeStatusServico/MDFeStatusServico.asmx',
  recepcaoEvento: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRecepcaoEvento/MDFeRecepcaoEvento.asmx',
  consultaNaoEnc: 'https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeConsNaoEnc/MDFeConsNaoEnc.asmx',
};

// --- Funções públicas ---

export function getNFeEndpoints(uf: string, ambiente: Ambiente): WebServices {
  const endpoints = NFE_ENDPOINTS[uf.toUpperCase()];
  if (!endpoints) {
    throw new Error(`UF não suportada para NFe: ${uf}`);
  }
  return endpoints[ambiente];
}

export function getNFCeEndpoints(uf: string, ambiente: Ambiente): WebServices {
  const endpoints = NFCE_ENDPOINTS[uf.toUpperCase()];
  if (!endpoints) {
    throw new Error(`UF não suportada para NFCe: ${uf}`);
  }
  return endpoints[ambiente];
}

export function getMDFeEndpoints(ambiente: Ambiente): MdfeWebServices {
  return ambiente === 'producao' ? MDFE_SVRS_PRODUCAO : MDFE_SVRS_HOMOLOGACAO;
}

export type { WebServices, MdfeWebServices, Ambiente };
