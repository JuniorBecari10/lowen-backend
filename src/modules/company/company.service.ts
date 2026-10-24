import { supabaseAdminClient } from "../../infra/supabase.js";
import { Errors } from "../../shared/errors.js";

export interface Company {
    id: string;
    owner_user_id: string;
    tax_id: string;
    legal_name: string;
    uf: string;
}

/**
 * Resolve a empresa do usuário autenticado. Esta é a ÚNICA forma permitida de
 * obter company_id em qualquer módulo -- nunca aceitar company_id vindo do
 * corpo/query da requisição.
 */
export async function getCompanyByOwner(
    userId: string,
): Promise<Company | null> {
    const { data, error } = await supabaseAdminClient
        .from("companies")
        .select("id, owner_user_id, tax_id, legal_name, uf")
        .eq("owner_user_id", userId)
        .maybeSingle();

    if (error) throw Errors.upstreamUnavailable("Falha ao consultar empresa.");
    return data;
}

/** Variante que lança 404 quando a empresa ainda não existe -- use nas rotas que exigem empresa. */
export async function requireCompanyByOwner(userId: string): Promise<Company> {
    const company = await getCompanyByOwner(userId);
    if (!company) throw Errors.notFound("Empresa ainda não cadastrada.");
    return company;
}

export async function createCompany(
    userId: string,
    input: { taxId: string; legalName: string; uf: string },
) {
    const existing = await getCompanyByOwner(userId);
    if (existing)
        throw Errors.conflict("Usuário já possui uma empresa cadastrada.");

    const { data, error } = await supabaseAdminClient
        .from("companies")
        .insert({
            owner_user_id: userId,
            tax_id: input.taxId,
            legal_name: input.legalName,
            uf: input.uf,
        })
        .select("id, owner_user_id, tax_id, legal_name, uf")
        .single();

    if (error)
        throw Errors.conflict(
            "Não foi possível criar a empresa (CNPJ pode já estar em uso).",
        );
    return data as Company;
}
