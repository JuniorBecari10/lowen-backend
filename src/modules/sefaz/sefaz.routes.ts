import { Router } from "express";
import { z } from "zod";
import { requireCompanyByOwner } from "../company/company.service.js";
import { Errors } from "../../shared/errors.js";
import {
  getSyncState,
  performDistNsuSync,
  SyncState,
} from "./sefaz.service.js";

export const sefazRouter = Router();

// GET /sefaz/sync - Ler estado de sincronização
sefazRouter.get("/sefaz/sync", async (req, res, next) => {
  try {
    const company = await requireCompanyByOwner(req.userId!);
    const environment = (req.query.environment as "homologacao" | "producao") ?? "producao";

    if (!["homologacao", "producao"].includes(environment)) {
      return next(Errors.invalidInput("Environment deve ser 'homologacao' ou 'producao'."));
    }

    const state = await getSyncState(company, environment);

    res.json({ companyId: company.id, environment, state });
  } catch (err) {
    next(err);
  }
});

// POST /sefaz/sync - Executar sincronização distNSU
sefazRouter.post("/sefaz/sync", async (req, res, next) => {
  try {
    const company = await requireCompanyByOwner(req.userId!);
    const environment = (req.query.environment as "homologacao" | "producao") ?? "producao";

    if (!["homologacao", "producao"].includes(environment)) {
      return next(Errors.invalidInput("Environment deve ser 'homologacao' ou 'producao'."));
    }

    const result = await performDistNsuSync(company, environment);

    res.json({
      companyId: company.id,
      environment,
      cStat: result.cStat,
      ultNsu: result.ultNsu,
      maxNsu: result.maxNsu,
      hasMore: result.hasMore,
      responsePath: result.responsePath,
      message: getSyncMessage(result.cStat, result.hasMore),
    });
  } catch (err) {
    next(err);
  }
});

function getSyncMessage(cStat: string, hasMore: boolean): string {
  switch (cStat) {
    case "138":
      return hasMore
        ? "Sincronização parcial: há mais documentos disponíveis. Execute novamente."
        : "Sincronização concluída.";
    case "137":
      return "NSU inválido informado. Recuperação manual necessária (recovery_required=true).";
    case "100":
      return "Sincronização realizada com sucesso.";
    case "656":
      return "Consulta de cadastro - não aplicável para distNSU.";
    default:
      return `Sincronização finalizada com cStat ${cStat}.`;
  }
}