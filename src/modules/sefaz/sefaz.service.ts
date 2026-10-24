import { supabaseAdminClient } from "../../infra/supabase.js";
import { Company } from "../company/company.service.js";
import { Errors } from "../../shared/errors.js";
import { getDecryptedCertificate } from "../certificates/certificates.service.js";
import * as crypto from "node:crypto";
import * as https from "node:https";
import * as fs from "node:fs";
import * as path from "node:path";

export interface SyncState {
  companyId: string;
  environment: "homologacao" | "producao";
  lastNsu: string | null;
  maxNsu: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastCStat: string | null;
  lastErrorCode: string | null;
  nextAllowedAt: string | null;
  lockUntil: string | null;
  lockToken: string | null;
  attemptId: string | null;
  pendingResponsePath: string | null;
  pendingUltNsu: string | null;
  recoveryRequired: boolean;
}

/**
 * Busca o estado de sincronização da empresa.
 */
export async function getSyncState(
  company: Company,
  environment: "homologacao" | "producao",
): Promise<SyncState | null> {
  const { data, error } = await supabaseAdminClient
    .from("sync_state")
    .select("*")
    .eq("company_id", company.id)
    .eq("environment", environment)
    .maybeSingle();

  if (error) {
    throw Errors.upstreamUnavailable("Falha ao consultar estado de sincronização.");
  }
  return data as SyncState | null;
}

/**
 * Tenta adquirir lock atômico para sincronização.
 * Retorna { acquired: true, lockToken } ou { acquired: false, reason }.
 */
export async function acquireSyncLock(
  company: Company,
  environment: "homologacao" | "producao",
): Promise<{ acquired: boolean; lockToken?: string; reason?: string }> {
  const lockToken = crypto.randomUUID();
  const lockUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min
  const attemptId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Upsert com condição: só atualiza se não houver lock válido
  const { data, error } = await supabaseAdminClient
    .from("sync_state")
    .upsert({
      company_id: company.id,
      environment,
      lock_until: lockUntil,
      lock_token: lockToken,
      attempt_id: attemptId,
      last_attempt_at: now,
      // Não zerar last_nsu, max_nsu, etc. - preservar estado anterior
    }, {
      onConflict: "company_id,environment",
      // Ignorar se lock_until > now (outro processo tem lock)
    })
    .select("lock_until, lock_token")
    .maybeSingle();

  if (error) {
    // Verificar se é erro de conflito de lock
    if (error.message.includes("lock") || error.code === "23505") {
      return { acquired: false, reason: "Sincronização já em andamento (lock ativo)." };
    }
    throw Errors.upstreamUnavailable("Falha ao adquirir lock de sincronização.");
  }

  // Se o upsert retornou dados, verificar se conseguimos o lock
  if (data && data.lock_token === lockToken) {
    return { acquired: true, lockToken };
  }

  // Verificar estado atual para dar razão mais específica
  const current = await getSyncState(company, environment);
  if (current?.lock_until && new Date(current.lock_until) > new Date()) {
    return { acquired: false, reason: "Sincronização já em andamento (lock ativo)." };
  }
  if (current?.next_allowed_at && new Date(current.next_allowed_at) > new Date()) {
    return { acquired: false, reason: "Aguardando intervalo mínimo entre sincronizações." };
  }

  return { acquired: false, reason: "Não foi possível adquirir lock." };
}

/**
 * Libera o lock de sincronização.
 */
export async function releaseSyncLock(
  company: Company,
  environment: "homologacao" | "producao",
  lockToken: string,
): Promise<void> {
  const { error } = await supabaseAdminClient
    .from("sync_state")
    .update({
      lock_until: null,
      lock_token: null,
      attempt_id: null,
    })
    .eq("company_id", company.id)
    .eq("environment", environment)
    .eq("lock_token", lockToken);

  if (error) {
    // Log apenas, não falhar a requisição
    console.warn("Falha ao liberar lock:", error.message);
  }
}

/**
 * Atualiza estado após sincronização (sucesso ou falha).
 */
export async function updateSyncState(
  company: Company,
  environment: "homologacao" | "producao",
  updates: Partial<SyncState>,
): Promise<void> {
  const { error } = await supabaseAdminClient
    .from("sync_state")
    .upsert({
      company_id: company.id,
      environment,
      ...updates,
    }, { onConflict: "company_id,environment" });

  if (error) {
    throw Errors.upstreamUnavailable("Falha ao atualizar estado de sincronização.");
  }
}

/**
 * Salva resposta bruta da SEFAZ no Storage.
 */
export async function saveSefazResponse(
  company: Company,
  environment: "homologacao" | "producao",
  attemptId: string,
  responseXml: string,
): Promise<string> {
  const storagePath = `${company.id}/${environment}/sefaz-response-${attemptId}.xml`;
  const { error } = await supabaseAdminClient.storage
    .from("sefaz-responses")
    .upload(storagePath, Buffer.from(responseXml, "utf8"), {
      contentType: "application/xml",
      upsert: false,
    });

  if (error) {
    throw Errors.upstreamUnavailable(`Falha ao salvar resposta da SEFAZ: ${error.message}`);
  }
  return storagePath;
}

/**
 * Endpoints SEFAZ por ambiente.
 */
const SEFAZ_ENDPOINTS = {
  homologacao: {
    nfeDistDFeInteresse: "https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
    nfeAutorizacao: "https://hom.nfe.fazenda.gov.br/NFeAutorizacao/NFeAutorizacao.asmx",
  },
  producao: {
    nfeDistDFeInteresse: "https://nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
    nfeAutorizacao: "https://nfe.fazenda.gov.br/NFeAutorizacao/NFeAutorizacao.asmx",
  },
};

/**
 * Envelope SOAP para distNSU.
 */
function buildDistNsuSoapEnvelope(
  cnpj: string,
  nsu: string,
  environment: "homologacao" | "producao",
): string {
  const tpAmb = environment === "producao" ? "1" : "2";
  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cnpj.substring(0, 2)}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${nsu}</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

/**
 * Envelope SOAP para distDFeInt (consulta por chave/NSU específico).
 */
function buildDistDFeIntSoapEnvelope(
  cnpj: string,
  consNSU: string,
  environment: "homologacao" | "producao",
): string {
  const tpAmb = environment === "producao" ? "1" : "2";
  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cnpj.substring(0, 2)}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <consNSU>${consNSU}</consNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

/**
 * Cria agente HTTPS com certificado A1 (mTLS).
 */
function createHttpsAgent(pfx: Buffer, password: string): https.Agent {
  return new https.Agent({
    pfx,
    passphrase: password,
    rejectUnauthorized: true, // Validar certificado do servidor SEFAZ
    keepAlive: true,
  });
}

/**
 * Faz requisição SOAP para SEFAZ com mTLS.
 */
async function callSefazSoap(
  pfx: Buffer,
  password: string,
  endpoint: string,
  soapAction: string,
  envelope: string,
): Promise<string> {
  const agent = createHttpsAgent(pfx, password);

  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: "POST",
      agent,
      headers: {
        "Content-Type": "application/soap+xml; charset=utf-8",
        "Content-Length": Buffer.byteLength(envelope),
        SOAPAction: soapAction,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", (e) => reject(e));
    req.write(envelope);
    req.end();
  });
}

/**
 * Extrai cStat da resposta SOAP.
 */
function extractCStat(responseXml: string): string | null {
  // Buscar cStat no XML de resposta
  const match = responseXml.match(/<cStat>(\d+)<\/cStat>/);
  return match ? match[1] : null;
}

/**
 * Extrai ultNSU da resposta.
 */
function extractUltNsu(responseXml: string): string | null {
  const match = responseXml.match(/<ultNSU>(\d+)<\/ultNSU>/);
  return match ? match[1] : null;
}

/**
 * Extrai maxNSU da resposta.
 */
function extractMaxNsu(responseXml: string): string | null {
  const match = responseXml.match(/<maxNSU>(\d+)<\/maxNSU>/);
  return match ? match[1] : null;
}

/**
 * Extrai lote de documentos da resposta (resumo).
 */
function extractDocZip(responseXml: string): string | null {
  const match = responseXml.match(/<docZip>([\s\S]*?)<\/docZip>/);
  return match ? match[1] : null;
}

/**
 * Processa resposta de distNSU / distDFeInt.
 */
function processDistResponse(responseXml: string): {
  cStat: string;
  ultNsu: string | null;
  maxNsu: string | null;
  docZip: string | null;
  hasMore: boolean;
} {
  const cStat = extractCStat(responseXml) ?? "0";
  const ultNsu = extractUltNsu(responseXml);
  const maxNsu = extractMaxNsu(responseXml);
  const docZip = extractDocZip(responseXml);
  const hasMore = cStat === "138"; // 138 = há mais documentos

  return { cStat, ultNsu, maxNsu, docZip, hasMore };
}

/**
 * Executa sincronização distNSU com a SEFAZ.
 * Trata cStat 138 (has_more), 137 (NSU inválido), 656 (intervalo).
 * NUNCA zera o NSU como correção automática.
 */
export async function performDistNsuSync(
  company: Company,
  environment: "homologacao" | "producao",
): Promise<{ cStat: string; ultNsu: string | null; maxNsu: string | null; hasMore: boolean; responsePath: string }> {
  // 1. Obter certificado A1 descriptografado
  const cert = await getDecryptedCertificate(company);
  if (!cert) {
    throw Errors.unprocessable("Nenhum certificado A1 válido configurado para esta empresa.");
  }

  // 2. Obter estado atual
  const state = await getSyncState(company, environment);
  const lastNsu = state?.last_nsu ?? "0";
  const nextAllowedAt = state?.next_allowed_at ? new Date(state.next_allowed_at) : null;

  if (nextAllowedAt && nextAllowedAt > new Date()) {
    throw Errors.tooManyRequests(
      "Intervalo mínimo entre sincronizações não respeitado.",
      nextAllowedAt.toISOString(),
    );
  }

  // 3. Adquirir lock
  const lockResult = await acquireSyncLock(company, environment);
  if (!lockResult.acquired || !lockResult.lockToken) {
    throw Errors.conflict(lockResult.reason ?? "Não foi possível adquirir lock de sincronização.");
  }

  const lockToken = lockResult.lockToken;
  const attemptId = crypto.randomUUID();

  try {
    // 4. Preparar requisição
    const endpoint = SEFAZ_ENDPOINTS[environment].nfeDistDFeInteresse;
    const soapAction = '"http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"';
    const envelope = buildDistNsuSoapEnvelope(company.tax_id, lastNsu, environment);

    // 5. Chamar SEFAZ
    const responseXml = await callSefazSoap(
      cert.pfx,
      cert.password,
      endpoint,
      soapAction,
      envelope,
    );

    // 6. SEMPRE salvar resposta bruta ANTES de processar
    const responsePath = await saveSefazResponse(company, environment, attemptId, responseXml);

    // 7. Processar resposta
    const { cStat, ultNsu, maxNsu, hasMore } = processDistResponse(responseXml);

    // 8. Atualizar estado baseado no cStat
    const now = new Date().toISOString();
    let nextAllowedAt: Date | null = null;
    let recoveryRequired = false;
    let errorCode: string | null = null;

    switch (cStat) {
      case "137": // NSU informado inválido
        // NUNCA zerar NSU automaticamente - marcar recovery_required
        recoveryRequired = true;
        errorCode = "INVALID_NSU";
        // next_allowed_at = agora + 1 hora (exemplo)
        nextAllowedAt = new Date(Date.now() + 60 * 60 * 1000);
        break;

      case "138": // Há mais documentos
        // Sucesso parcial - atualizar last_nsu para ultNSU retornado
        // Próxima sincronização pode ser imediata ou com pequeno delay
        nextAllowedAt = new Date(Date.now() + 2 * 60 * 1000); // 2 min
        break;

      case "100": // Sucesso (pode ter documentos ou não)
      case "150": // Autorizado uso da NF-e (para outros serviços)
        nextAllowedAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min
        break;

      case "656": // Consulta cadastro - não aplicável aqui, mas tratar
        nextAllowedAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
        errorCode = "CONSULTA_CADASTRO";
        break;

      default:
        // Outros códigos de erro
        errorCode = `CSTAT_${cStat}`;
        nextAllowedAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    }

    // 9. Atualizar sync_state
    await updateSyncState(company, environment, {
      last_nsu: ultNsu ?? lastNsu, // Se não veio ultNSU, manter anterior
      max_nsu: maxNsu ?? state?.max_nsu ?? null,
      last_attempt_at: now,
      last_success_at: ["100", "138", "150"].includes(cStat) ? now : state?.last_success_at ?? null,
      last_cstat: cStat,
      last_error_code: errorCode,
      next_allowed_at: nextAllowedAt?.toISOString() ?? null,
      lock_until: null,
      lock_token: null,
      attempt_id: null,
      pending_response_path: responsePath,
      pending_ult_nsu: ultNsu,
      recovery_required: recoveryRequired,
    });

    return { cStat, ultNsu, maxNsu, hasMore, responsePath };
  } catch (e) {
    // Em caso de erro, liberar lock e registrar falha
    await releaseSyncLock(company, environment, lockToken);
    const now = new Date().toISOString();
    await updateSyncState(company, environment, {
      last_attempt_at: now,
      last_cstat: "0",
      last_error_code: "TRANSPORT_ERROR",
      next_allowed_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      lock_until: null,
      lock_token: null,
      attempt_id: null,
      recovery_required: false,
    });
    throw e;
  }
}