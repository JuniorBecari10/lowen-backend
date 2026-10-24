import { supabaseAdminClient } from "../../infra/supabase.js";
import { Company } from "../company/company.service.js";
import { Errors } from "../../shared/errors.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import puppeteer from "puppeteer";

export interface DanfeData {
  accessKey: string;
  number: string;
  series: string;
  issuedAt: string;
  issuerName: string;
  issuerTaxId: string;
  issuerUf: string;
  recipientName: string;
  recipientTaxId: string;
  recipientUf: string;
  totalAmount: string;
  cfops: string[];
  protocol: string | null;
  xmlContent: string;
}

/**
 * Extrai dados essenciais do XML para o template do DANFE.
 */
function extractDanfeData(xmlString: string, nfe: Record<string, unknown>): DanfeData {
  const nfeProc = (nfe.nfeProc ?? nfe) as Record<string, unknown>;
  const nfeElement = (nfeProc.NFe ?? nfeProc.nfe) as Record<string, unknown> | undefined;
  const infNFe = (nfeElement?.infNFe ?? nfeElement?.infNfe) as Record<string, unknown> | undefined;
  const protNFe = (nfeProc.protNFe ?? nfeProc.protNfe) as Record<string, unknown> | undefined;
  const infProt = (protNFe?.infProt) as Record<string, unknown> | undefined;

  const ide = (infNFe?.ide) as Record<string, unknown> | undefined;
  const emit = (infNFe?.emit) as Record<string, unknown> | undefined;
  const dest = (infNFe?.dest) as Record<string, unknown> | undefined;
  const totalObj = (infNFe?.total) as Record<string, unknown> | undefined;
  const total = (totalObj?.ICMSTot ?? totalObj?.icmsTot) as Record<string, unknown> | undefined;

  const accessKey = String((infNFe as Record<string, unknown>)?.["@_Id"] ?? "").replace("NFe", "");
  const protocol = infProt?.nProt ? String(infProt.nProt) : null;

  // Extrair CFOPs
  const cfopsSet = new Set<string>();
  const items = Array.isArray(infNFe?.det) ? infNFe.det : infNFe?.det ? [infNFe.det] : [];
  for (const item of items) {
    const prod = (item.prod ?? item.Prod) as Record<string, unknown> | undefined;
    const cfop = String(prod?.CFOP ?? prod?.cfop ?? "");
    if (cfop) cfopsSet.add(cfop);
  }

  return {
    accessKey,
    number: String(ide?.nNF ?? ide?.nNf ?? ""),
    series: String(ide?.serie ?? ide?.Serie ?? ""),
    issuedAt: String(ide?.dhEmi ?? ide?.dhEmi ?? ""),
    issuerName: String(emit?.xNome ?? emit?.xnome ?? ""),
    issuerTaxId: String(emit?.CNPJ ?? emit?.CPF ?? ""),
    issuerUf: String((emit?.enderEmit as Record<string, unknown>)?.UF ?? (emit?.enderEmit as Record<string, unknown>)?.Uf ?? ""),
    recipientName: String(dest?.xNome ?? dest?.xnome ?? ""),
    recipientTaxId: String(dest?.CNPJ ?? dest?.CPF ?? ""),
    recipientUf: String((dest?.enderDest as Record<string, unknown>)?.UF ?? (dest?.enderDest as Record<string, unknown>)?.Uf ?? ""),
    totalAmount: String(total?.vNF ?? total?.VNF ?? "0"),
    cfops: Array.from(cfopsSet),
    protocol,
    xmlContent: xmlString,
  };
}

/**
 * Formata data para exibição no DANFE (DD/MM/YYYY HH:mm:ss).
 */
function formatDateForDanfe(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

/**
 * Formata CNPJ/CPF para exibição.
 */
function formatTaxId(taxId: string): string {
  const digits = taxId.replace(/\D/g, "");
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return taxId;
}

/**
 * Formata valor monetário para exibição.
 */
function formatCurrency(value: string): string {
  const num = parseFloat(value);
  return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Escapa HTML para prevenir XSS no template.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "\"")
    .replace(/'/g, "&#039;");
}

/**
 * Gera o HTML do DANFE simplificado.
 */
function generateDanfeHtml(data: DanfeData): string {
  const formattedDate = formatDateForDanfe(data.issuedAt);
  const formattedIssuerTaxId = formatTaxId(data.issuerTaxId);
  const formattedRecipientTaxId = formatTaxId(data.recipientTaxId);
  const formattedTotal = formatCurrency(data.totalAmount);

  const protocolHtml = data.protocol
    ? `<div class="protocol"><strong>Protocolo de Autorização:</strong> ${escapeHtml(data.protocol)}</div>`
    : '<div class="protocol warning">NF-e sem protocolo de autorização (resumo).</div>';

  const cfopsHtml = data.cfops.length > 0
    ? data.cfops.map((c) => `<span class="cfop">${escapeHtml(c)}</span>`).join("")
    : '<span class="cfop">-</span>';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>DANFE - ${escapeHtml(data.accessKey)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DejaVu Sans', 'Helvetica', 'Arial', sans-serif; font-size: 10px; color: #000; line-height: 1.3; padding: 20px; }
    .page { max-width: 210mm; margin: 0 auto; }
    .header { border: 1px solid #000; padding: 10px; margin-bottom: 10px; }
    .header-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
    .header-title { font-size: 16px; font-weight: bold; text-align: center; flex: 1; }
    .header-right { text-align: right; font-size: 9px; }
    .section { border: 1px solid #000; padding: 8px; margin-bottom: 10px; }
    .section-title { font-weight: bold; font-size: 11px; margin-bottom: 5px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
    .row { display: flex; margin-bottom: 3px; }
    .label { font-weight: bold; min-width: 140px; }
    .value { flex: 1; }
    .two-cols { display: flex; }
    .two-cols .col { flex: 1; }
    .two-cols .col:first-child { padding-right: 10px; }
    .protocol { font-size: 11px; padding: 5px; background: #f0f0f0; border: 1px solid #ccc; margin-top: 10px; }
    .protocol.warning { background: #fff3cd; border-color: #ffc107; }
    .cfop { display: inline-block; background: #e9ecef; border: 1px solid #ccc; padding: 2px 6px; margin: 2px; border-radius: 3px; font-size: 9px; }
    .access-key { font-family: monospace; font-size: 9px; letter-spacing: 1px; word-break: break-all; }
    .total { font-size: 14px; font-weight: bold; text-align: right; margin-top: 10px; }
    @media print { body { padding: 0; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-top">
        <div class="header-right">
          <div>DOCUMENTO AUXILIAR DA</div>
          <div>NOTA FISCAL ELETRÔNICA</div>
        </div>
        <div class="header-title">DANFE</div>
        <div class="header-right">
          <div>Nº ${escapeHtml(data.number)}</div>
          <div>Série ${escapeHtml(data.series)}</div>
        </div>
      </div>
      <div class="access-key"><strong>Chave de Acesso:</strong> ${escapeHtml(data.accessKey)}</div>
    </div>

    <div class="section">
      <div class="section-title">EMITENTE</div>
      <div class="row"><span class="label">Razão Social:</span><span class="value">${escapeHtml(data.issuerName)}</span></div>
      <div class="row"><span class="label">CNPJ/CPF:</span><span class="value">${formattedIssuerTaxId}</span></div>
      <div class="row"><span class="label">UF:</span><span class="value">${escapeHtml(data.issuerUf)}</span></div>
    </div>

    <div class="section">
      <div class="section-title">DESTINATÁRIO</div>
      <div class="row"><span class="label">Razão Social:</span><span class="value">${escapeHtml(data.recipientName)}</span></div>
      <div class="row"><span class="label">CNPJ/CPF:</span><span class="value">${formattedRecipientTaxId}</span></div>
      <div class="row"><span class="label">UF:</span><span class="value">${escapeHtml(data.recipientUf)}</span></div>
    </div>

    <div class="section">
      <div class="section-title">DADOS DA NF-e</div>
      <div class="row"><span class="label">Data/Hora Emissão:</span><span class="value">${formattedDate}</span></div>
      <div class="row"><span class="label">CFOP(s):</span><span class="value">${cfopsHtml}</span></div>
    </div>

    <div class="total">
      <div>Valor Total da NF-e: R$ ${formattedTotal}</div>
    </div>

    ${protocolHtml}

    <div class="section no-print" style="margin-top: 20px; font-size: 9px; color: #666;">
      <p>Este DANFE foi gerado automaticamente pelo sistema. Não substitui a NF-e original.</p>
      <p>Para verificar a autenticidade, acesse o portal da SEFAZ e consulte pela chave de acesso.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Gera o PDF do DANFE usando Puppeteer.
 * Nunca persiste o PDF permanentemente - retorna como Buffer.
 */
export async function generateDanfePdf(
  company: Company,
  nfeId: string,
  disposition: "inline" | "attachment" = "inline",
): Promise<{ pdfBuffer: Buffer; filename: string }> {
  // Buscar NF-e
  const { data: nfe, error } = await supabaseAdminClient
    .from("nfe_documents")
    .select("*")
    .eq("id", nfeId)
    .eq("company_id", company.id)
    .maybeSingle();

  if (error) {
    throw Errors.upstreamUnavailable("Falha ao buscar NF-e.");
  }
  if (!nfe) {
    throw Errors.notFound("NF-e não encontrada.");
  }

  // Verificar se tem XML completo e protocolo válido
  if (!nfe.xml_path) {
    throw Errors.unprocessable("XML original não disponível para geração do DANFE.");
  }
  if (!nfe.authorization_protocol) {
    throw Errors.unprocessable("NF-e não possui protocolo de autorização. Apenas NF-es autorizadas podem gerar DANFE completo.");
  }

  // Baixar XML do Storage
  const { data: xmlData, error: downloadError } = await supabaseAdminClient.storage
    .from("fiscal-documents")
    .download(nfe.xml_path);

  if (downloadError || !xmlData) {
    throw Errors.notFound("Arquivo XML não encontrado no Storage.");
  }

  const xmlArrayBuffer = await xmlData.arrayBuffer();
  const xmlString = Buffer.from(xmlArrayBuffer).toString("utf8");

  // Parsear XML para extrair dados
  const { XMLParser } = await import("fast-xml-parser");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: true,
    trimValues: true,
    processEntities: false,
  });

  let parsedNfe: Record<string, unknown>;
  try {
    parsedNfe = parser.parse(xmlString);
  } catch {
    throw Errors.unprocessable("Falha ao parsear XML para geração do DANFE.");
  }

  // Extrair dados para o template
  const danfeData = extractDanfeData(xmlString, parsedNfe);

  // Gerar HTML
  const html = generateDanfeHtml(danfeData);

  // Gerar PDF com Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", right: "15mm", bottom: "15mm", left: "15mm" },
    });
    await browser.close();

    const filename = `DANFE-${danfeData.accessKey}.pdf`;
    return { pdfBuffer: Buffer.from(pdfBuffer), filename };
  } catch (e) {
    await browser.close();
    throw Errors.upstreamUnavailable(`Falha ao gerar PDF: ${(e as Error).message}`);
  }
}