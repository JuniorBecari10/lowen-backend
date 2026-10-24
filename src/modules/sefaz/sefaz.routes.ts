import { Router } from "express";
import { requireCompanyByOwner } from "../company/company.service.js";
import { Errors } from "../../shared/errors.js";

export const sefazRouter = Router();

sefazRouter.get("/sefaz/sync", async (req, res, next) => {
    try {
        const company = await requireCompanyByOwner(req.userId!);
        // TODO (E6): ler `sync_state` (last_nsu, next_allowed_at, lock_until, cStat).
        res.json({ companyId: company.id, state: null });
    } catch (err) {
        next(err);
    }
});

sefazRouter.post("/sefaz/sync", async (req, res, next) => {
    try {
        await requireCompanyByOwner(req.userId!);
        // TODO (E6): adquirir lock atômico em sync_state; exigir A1 utilizável e
        // next_allowed_at permitido; chamar distNSU via SOAP/TLS com o A1
        // decifrado apenas em memória; salvar resposta bruta no Storage por
        // attempt_id ANTES de extrair; tratar cStat 138 (has_more)/137/656 sem
        // nunca zerar o NSU como correção automática.
        next(
            Errors.unprocessable(
                "Sincronização com a SEFAZ ainda não implementada (etapa E6).",
            ),
        );
    } catch (err) {
        next(err);
    }
});
