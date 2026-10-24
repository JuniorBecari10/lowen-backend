import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { supabaseAdminClient } from "../../infra/supabase.js";
import { env } from "../../config/env.js";
import { Errors } from "../../shared/errors.js";
import { Company } from "../company/company.service.js";

export interface NfeMetadata {
  accessKey: string;
  model: string;
  number: string;
  series: string;
  issuedAt: string;
  schemaVersion: string;
  issuerTaxId: string;
  recipientTaxId: string;
  issuerName: string;
  recipientName: string;
  issuerUf: string;
  recipientUf: string;
  tpNF: string;
  idDest: string;
  movement: "ENTRY" | "EXIT" | "REVIEW";
  totalAmount: string;
  totalSource: string;
  icmsAmount: string | null;
  difalDestAmount: string | null;
  fcpDestAmount: string | null;
  cfops: string[];
  documentKind: "SUMMARY" | "FULL";
  contentOrigin: "MANUAL" | "SEFAZ";
  authorizationProtocol: string | null;
  extractionStatus: string;
  warnings: string[];
  documentDetails: Record<string, unknown>;
  taxReading: Record<string, unknown>;
}

export interface ParsedNfe {
  metadata: NfeMetadata;
  xmlBytes: Buffer;
  xmlSha256: string;
}

/**
 * Parser de NF-e usando fast-xml-parser sem DTD/entidades externas.
 * Extrai metadados, itens e impostos do XML da NF-e (modelo 55) ou nfeProc.
 */
export async function parseNfeXml(xmlBytes: Buffer): Promise<ParsedNfe> {
  if (xmlBytes.length > env.XML_MAX_BYTES) {
    throw Errors.payloadTooLarge(`XML excede o limite de ${env.XML_MAX_BYTES} bytes.`);
  }

  const xmlString = xmlBytes.toString("utf8");
  const xmlSha256 = createHash("sha256").update(xmlBytes).digest("hex");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: true,
    trimValues: true,
    allowBooleanAttributes: true,
    parseTagValue: true,
    ignoreDeclaration: true,
    removeNSPrefix: true,
    // Segurança: não processar DTD nem entidades externas
    processEntities: false,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xmlString);
  } catch (e) {
    throw Errors.unprocessable("XML malformado ou inválido.");
  }

  // Encontrar o elemento NFe (pode estar dentro de nfeProc)
  const nfeProc = (parsed.nfeProc ?? parsed) as Record<string, unknown>;
  const nfe = (nfeProc.NFe ?? nfeProc.nfe) as Record<string, unknown> | undefined;
  const infNFe = (nfe?.infNFe ?? nfe?.infNfe) as Record<string, unknown> | undefined;

  if (!infNFe) {
    throw Errors.unprocessable("XML não contém elemento infNFe válido.");
  }

  const ide = (infNFe.ide ?? {}) as Record<string, unknown>;
  const emit = (infNFe.emit ?? {}) as Record<string, unknown>;
  const dest = (infNFe.dest ?? {}) as Record<string, unknown>;
  const totalObj = (infNFe.total ?? {}) as Record<string, unknown>;
  const total = (totalObj.ICMSTot ?? totalObj.icmsTot ?? {}) as Record<string, unknown>;
  const protNFe = (nfeProc.protNFe ?? nfeProc.protNfe) as Record<string, unknown> | undefined;
  const infProt = (protNFe?.infProt ?? {}) as Record<string, unknown>;

  // Validar modelo 55
  const model = String(ide.mod ?? ide.Mod ?? "");
  if (model !== "55") {
    throw Errors.unprocessable("Apenas NF-e modelo 55 é suportada.");
  }

  // Validar protocolo de autorização (se presente)
  const cStat = String(infProt.cStat ?? "");
  const authorized = ["100", "150"].includes(cStat);
  if (protNFe && !authorized) {
    throw Errors.unprocessable(`NF-e não autorizada (cStat: ${cStat}).`);
  }

  const accessKey = String((infNFe as Record<string, unknown>)["@_Id"] ?? "").replace("NFe", "");
  if (!accessKey || accessKey.length !== 44) {
    throw Errors.unprocessable("Chave de acesso inválida.");
  }

  // Determinar movimento (tpNF: 0=entrada, 1=saída)
  const tpNF = String(ide.tpNF ?? ide.tpNf ?? "");
  let movement: "ENTRY" | "EXIT" | "REVIEW" = "REVIEW";
  if (tpNF === "0") movement = "ENTRY";
  else if (tpNF === "1") movement = "EXIT";

  // Determinar idDest (1=operação interna, 2=interestadual, 3=com exterior)
  const idDest = String(ide.idDest ?? "");

  // Extrair CFOPs dos itens
  const cfopsSet = new Set<string>();
  const items = Array.isArray(infNFe.det) ? infNFe.det : infNFe.det ? [infNFe.det] : [];
  for (const item of items) {
    const prod = ((item as Record<string, unknown>).prod ?? (item as Record<string, unknown>).Prod ?? {}) as Record<string, unknown>;
    const cfop = String(prod.CFOP ?? prod.cfop ?? "");
    if (cfop) cfopsSet.add(cfop);
  }

  // Calcular totais de ICMS, DIFAL, FCP (leitura fiscal básica)
  let icmsAmount: string | null = null;
  let difalDestAmount: string | null = null;
  let fcpDestAmount: string | null = null;

  const vICMS = total.vICMS ?? total.VICMS;
  const vICMSDeson = total.vICMSDeson ?? total.VICMSDeson;
  const vFCPDest = total.vFCPDest ?? total.VFCPDest;
  const vICMSDifal = total.vICMSDifal ?? total.VICMSDifal;

  if (vICMS !== undefined) {
    const val = parseFloat(String(vICMS)) - parseFloat(String(vICMSDeson ?? "0"));
    icmsAmount = val.toFixed(2);
  }
  if (vICMSDifal !== undefined) {
    difalDestAmount = parseFloat(String(vICMSDifal)).toFixed(2);
  }
  if (vFCPDest !== undefined) {
    fcpDestAmount = parseFloat(String(vFCPDest)).toFixed(2);
  }

  // Determinar documentKind e contentOrigin
  const documentKind = protNFe ? "FULL" : "SUMMARY";
  const contentOrigin = protNFe ? "SEFAZ" : "MANUAL";

  const metadata: NfeMetadata = {
    accessKey,
    model,
    number: String(ide.nNF ?? ide.nNf ?? ""),
    series: String(ide.serie ?? ide.Serie ?? ""),
    issuedAt: String(ide.dhEmi ?? ide.dhEmi ?? ""),
    schemaVersion: String(ide.verProc ?? ide.verProc ?? ""),
    issuerTaxId: String(emit.CNPJ ?? emit.CPF ?? ""),
    recipientTaxId: String(dest.CNPJ ?? dest.CPF ?? ""),
    issuerName: String(emit.xNome ?? emit.xnome ?? ""),
    recipientName: String(dest.xNome ?? dest.xnome ?? ""),
    issuerUf: String(((emit.enderEmit as Record<string, unknown>)?.UF ?? (emit.enderEmit as Record<string, unknown>)?.Uf ?? "")),
    recipientUf: String(((dest.enderDest as Record<string, unknown>)?.UF ?? (dest.enderDest as Record<string, unknown>)?.Uf ?? "")),
    tpNF,
    idDest,
    movement,
    totalAmount: String(total.vNF ?? total.VNF ?? "0"),
    totalSource: "vNF",
    icmsAmount,
    difalDestAmount,
    fcpDestAmount,
    cfops: Array.from(cfopsSet),
    documentKind,
    contentOrigin,
    authorizationProtocol: authorized ? String(infProt.nProt ?? "") : null,
    extractionStatus: "SUCCESS",
    warnings: [],
    documentDetails: { ide, emit, dest, total, items: items.length },
    taxReading: { vICMS, vICMSDeson, vFCPDest, vICMSDifal },
  };

  return { metadata, xmlBytes, xmlSha256 };
}

/**
 * Salva o XML original no Storage privado `fiscal-documents`.
 */
export async function storeXmlInStorage(
  companyId: string,
  accessKey: string,
  xmlBytes: Buffer,
  environment: "homologacao" | "producao",
): Promise<string> {
  const path = `${companyId}/${environment}/${accessKey}.xml`;
  const { error } = await supabaseAdminClient.storage
    .from("fiscal-documents")
    .upload(path, xmlBytes, {
      contentType: "application/xml",
      upsert: false,
    });

  if (error) {
    // Se já existe, não é erro (idempotência)
    if (error.message.includes("already exists") || error.message.includes("duplicate")) {
      return path;
    }
    throw Errors.upstreamUnavailable(`Falha ao armazenar XML: ${error.message}`);
  }
  return path;
}

/**
 * Persiste a NF-e na tabela nfe_documents com idempotência.
 */
export async function upsertNfeDocument(
  company: Company,
  environment: "homologacao" | "producao",
  parsed: ParsedNfe,
  xmlPath: string,
): Promise<{ id: string; isNew: boolean }> {
  const { metadata, xmlSha256 } = parsed;

  const { data: existing, error: selectError } = await supabaseAdminClient
    .from("nfe_documents")
    .select("id")
    .eq("company_id", company.id)
    .eq("environment", environment)
    .eq("access_key", metadata.accessKey)
    .maybeSingle();

  if (selectError) {
    throw Errors.upstreamUnavailable("Falha ao verificar NF-e existente.");
  }

  if (existing) {
    // Já existe: atualizar apenas campos que podem mudar (protocolo, status, updated_at)
    const { error: updateError } = await supabaseAdminClient
      .from("nfe_documents")
      .update({
        authorization_protocol: metadata.authorizationProtocol,
        fiscal_status: metadata.authorizationProtocol ? "AUTHORIZED" : "PENDING",
        status_source: metadata.contentOrigin,
        status_observed_at: new Date().toISOString(),
        extraction_status: metadata.extractionStatus,
        warnings: metadata.warnings,
        document_details: metadata.documentDetails,
        tax_reading: metadata.taxReading,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updateError) {
      throw Errors.upstreamUnavailable("Falha ao atualizar NF-e existente.");
    }
    return { id: existing.id, isNew: false };
  }

  // Nova NF-e: inserir
  const { data: inserted, error: insertError } = await supabaseAdminClient
    .from("nfe_documents")
    .insert({
      company_id: company.id,
      environment,
      access_key: metadata.accessKey,
      model: metadata.model,
      number: metadata.number,
      series: metadata.series,
      issued_at: metadata.issuedAt,
      schema_version: metadata.schemaVersion,
      parser_version: "fast-xml-parser-v1",

      issuer_tax_id: metadata.issuerTaxId,
      recipient_tax_id: metadata.recipientTaxId,
      issuer_name: metadata.issuerName,
      recipient_name: metadata.recipientName,
      issuer_uf: metadata.issuerUf,
      recipient_uf: metadata.recipientUf,
      tp_nf: metadata.tpNF,
      id_dest: metadata.idDest,
      movement: metadata.movement,

      total_amount: metadata.totalAmount,
      total_source: metadata.totalSource,
      icms_amount: metadata.icmsAmount,
      difal_dest_amount: metadata.difalDestAmount,
      fcp_dest_amount: metadata.fcpDestAmount,
      cfops: metadata.cfops,

      document_kind: metadata.documentKind,
      content_origin: metadata.contentOrigin,
      xml_path: xmlPath,
      xml_sha256: xmlSha256,
      document_details: metadata.documentDetails,
      tax_reading: metadata.taxReading,

      fiscal_status: metadata.authorizationProtocol ? "AUTHORIZED" : "PENDING",
      status_source: metadata.contentOrigin,
      status_observed_at: metadata.authorizationProtocol ? new Date().toISOString() : null,
      authorization_protocol: metadata.authorizationProtocol,
      extraction_status: metadata.extractionStatus,
      warnings: metadata.warnings,
    })
    .select("id")
    .single();

  if (insertError) {
    // Race condition: outro request inseriu ao mesmo tempo
    if (insertError.message.includes("duplicate") || insertError.message.includes("unique")) {
      const { data: race } = await supabaseAdminClient
        .from("nfe_documents")
        .select("id")
        .eq("company_id", company.id)
        .eq("environment", environment)
        .eq("access_key", metadata.accessKey)
        .single();
      return { id: race!.id, isNew: false };
    }
    throw Errors.upstreamUnavailable(`Falha ao inserir NF-e: ${insertError.message}`);
  }

  return { id: inserted.id, isNew: true };
}

/**
 * Lista NF-es com filtros, paginação e ordenação estável.
 */
export async function listNfeDocuments(
  company: Company,
  filters: {
    from?: string;
    to?: string;
    movement?: "ENTRY" | "EXIT" | "REVIEW";
    number?: string;
    counterpartyTaxId?: string;
    accessKey?: string;
    status?: string;
    environment?: "homologacao" | "producao";
    page: number;
    pageSize: number;
  },
): Promise<{ items: unknown[]; total: number }> {
  let query = supabaseAdminClient
    .from("nfe_documents")
    .select(
      `id, environment, access_key, model, number, series, issued_at, issuer_tax_id,
       recipient_tax_id, issuer_name, recipient_name, issuer_uf, recipient_uf,
       tp_nf, id_dest, movement, total_amount, icms_amount, difal_dest_amount,
       fcp_dest_amount, cfops, document_kind, content_origin, fiscal_status,
       status_source, status_observed_at, authorization_protocol, extraction_status,
       warnings, imported_at, updated_at`,
      { count: "exact" },
    )
    .eq("company_id", company.id);

  if (filters.environment) {
    query = query.eq("environment", filters.environment);
  }
  if (filters.from) {
    query = query.gte("issued_at", filters.from);
  }
  if (filters.to) {
    query = query.lte("issued_at", filters.to);
  }
  if (filters.movement) {
    query = query.eq("movement", filters.movement);
  }
  if (filters.number) {
    query = query.ilike("number", `%${filters.number}%`);
  }
  if (filters.counterpartyTaxId) {
    query = query.or(
      `issuer_tax_id.ilike.%${filters.counterpartyTaxId}%,recipient_tax_id.ilike.%${filters.counterpartyTaxId}%`,
    );
  }
  if (filters.accessKey) {
    query = query.eq("access_key", filters.accessKey);
  }
  if (filters.status) {
    query = query.eq("fiscal_status", filters.status);
  }

  // Ordenação estável: issued_at desc, id desc
  query = query.order("issued_at", { ascending: false, nullsFirst: false });
  query = query.order("id", { ascending: false });

  // Paginação
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    throw Errors.upstreamUnavailable("Falha ao consultar NF-es.");
  }

  return { items: data ?? [], total: count ?? 0 };
}

/**
 * Busca NF-e por ID + company_id.
 */
export async function getNfeDocumentById(
  company: Company,
  id: string,
): Promise<unknown | null> {
  const { data, error } = await supabaseAdminClient
    .from("nfe_documents")
    .select("*")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (error) {
    throw Errors.upstreamUnavailable("Falha ao buscar NF-e.");
  }
  return data;
}

/**
 * Busca XML do Storage.
 */
export async function getXmlFromStorage(xmlPath: string): Promise<Buffer> {
  const { data, error } = await supabaseAdminClient.storage
    .from("fiscal-documents")
    .download(xmlPath);

  if (error) {
    throw Errors.notFound("Arquivo XML não encontrado no Storage.");
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Busca eventos vinculados à mesma chave de acesso.
 */
export async function getNfeEvents(
  company: Company,
  accessKey: string,
  environment: "homologacao" | "producao",
): Promise<unknown[]> {
  const { data, error } = await supabaseAdminClient
    .from("nfe_events")
    .select("*")
    .eq("company_id", company.id)
    .eq("environment", environment)
    .eq("access_key", accessKey)
    .order("event_sequence", { ascending: true });

  if (error) {
    throw Errors.upstreamUnavailable("Falha ao buscar eventos.");
  }
  return data ?? [];
}