import { Router } from "express";
import { requireCompanyByOwner } from "../company/company.service.js";
import { Errors } from "../../shared/errors.js";

export const danfeRouter = Router();

danfeRouter.get("/nfe/:id/danfe", async (req, res, next) => {
    try {
        await requireCompanyByOwner(req.userId!);
        // TODO (E5): exigir XML completo + protocolo válido; carregar XML original
        // do Storage; renderizar template HTML -> Puppeteer -> application/pdf;
        // Content-Disposition conforme ?disposition=inline|attachment; nunca
        // persistir o PDF permanentemente; escapar todo texto do XML no template.
        next(
            Errors.unprocessable(
                "Geração de DANFE ainda não implementada (etapa E5).",
            ),
        );
    } catch (err) {
        next(err);
    }
});
