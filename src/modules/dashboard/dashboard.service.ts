import { supabaseAdminClient } from "../../infra/supabase.js";
import { Company } from "../company/company.service.js";

export interface DashboardTotals {
  entriesAmount: string | null;
  exitsAmount: string | null;
}

export interface DashboardTaxes {
  icms: string | null;
  difalDest: string | null;
  fcpDest: string | null;
}

export interface DashboardCoverage {
  totalEligible: number;
  withIcms: number;
  withDifal: number;
  withFcp: number;
  icmsCoverage: string;
  difalCoverage: string;
  fcpCoverage: string;
}

export interface DashboardResult {
  companyId: string;
  totals: DashboardTotals;
  taxes: DashboardTaxes;
  coverage: DashboardCoverage;
  period: { from: string | null; to: string | null };
  environment: "homologacao" | "producao" | "all";
}

/**
 * Agrega NF-es elegíveis para o dashboard.
 * Elegíveis = situação conhecida + XML completo + movimento definido (ENTRY/EXIT).
 * Separa ICMS/DIFAL/FCP em três totais independentes com indicação de cobertura.
 */
export async function getDashboardAggregates(
  company: Company,
  params: {
    from?: string;
    to?: string;
    environment?: "homologacao" | "producao" | "all";
  },
): Promise<DashboardResult> {
  const { from, to, environment = "all" } = params;

  // Buscar NF-es elegíveis
  let query = supabaseAdminClient
    .from("nfe_documents")
    .select(
      `movement, total_amount, icms_amount, difal_dest_amount, fcp_dest_amount,
       fiscal_status, xml_path, issued_at, environment`,
    )
    .eq("company_id", company.id)
    .in("movement", ["ENTRY", "EXIT"])
    .not("xml_path", "is", null)
    .not("fiscal_status", "is", null);

  if (environment !== "all") {
    query = query.eq("environment", environment);
  }
  if (from) {
    query = query.gte("issued_at", from);
  }
  if (to) {
    query = query.lte("issued_at", to);
  }

  const { data: nfes, error } = await query;

  if (error) {
    throw new Error(`Falha ao consultar NF-es para dashboard: ${error.message}`);
  }

  const items = nfes ?? [];
  const totalEligible = items.length;

  // Agregar totais por movimento
  let entriesAmount = 0;
  let exitsAmount = 0;
  let icmsTotal = 0;
  let difalTotal = 0;
  let fcpTotal = 0;
  let withIcms = 0;
  let withDifal = 0;
  let withFcp = 0;

  for (const nfe of items) {
    const total = parseFloat(String(nfe.total_amount ?? "0"));
    if (nfe.movement === "ENTRY") {
      entriesAmount += total;
    } else if (nfe.movement === "EXIT") {
      exitsAmount += total;
    }

    const icms = nfe.icms_amount !== null && nfe.icms_amount !== undefined
      ? parseFloat(String(nfe.icms_amount))
      : null;
    const difal = nfe.difal_dest_amount !== null && nfe.difal_dest_amount !== undefined
      ? parseFloat(String(nfe.difal_dest_amount))
      : null;
    const fcp = nfe.fcp_dest_amount !== null && nfe.fcp_dest_amount !== undefined
      ? parseFloat(String(nfe.fcp_dest_amount))
      : null;

    if (icms !== null && !isNaN(icms)) {
      icmsTotal += icms;
      withIcms++;
    }
    if (difal !== null && !isNaN(difal)) {
      difalTotal += difal;
      withDifal++;
    }
    if (fcp !== null && !isNaN(fcp)) {
      fcpTotal += fcp;
      withFcp++;
    }
  }

  const formatCoverage = (withValue: number, total: number): string => {
    if (total === 0) return "0 de 0";
    return `${withValue} de ${total}`;
  };

  return {
    companyId: company.id,
    totals: {
      entriesAmount: totalEligible > 0 ? entriesAmount.toFixed(2) : null,
      exitsAmount: totalEligible > 0 ? exitsAmount.toFixed(2) : null,
    },
    taxes: {
      icms: withIcms > 0 ? icmsTotal.toFixed(2) : null,
      difalDest: withDifal > 0 ? difalTotal.toFixed(2) : null,
      fcpDest: withFcp > 0 ? fcpTotal.toFixed(2) : null,
    },
    coverage: {
      totalEligible,
      withIcms,
      withDifal,
      withFcp,
      icmsCoverage: formatCoverage(withIcms, totalEligible),
      difalCoverage: formatCoverage(withDifal, totalEligible),
      fcpCoverage: formatCoverage(withFcp, totalEligible),
    },
    period: { from: from ?? null, to: to ?? null },
    environment,
  };
}