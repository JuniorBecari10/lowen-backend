import { Router } from "express";
import { requireCompanyByOwner } from "../company/company.service.js";
import { Errors } from "../../shared/errors.js";
import { generateDanfePdf } from "./danfe.service.js";

export const danfeRouter = Router();

// GET /nfe/:id/danfe - Gerar DANFE em PDF
danfeRouter.get("/nfe/:id/danfe", async (req, res, next) => {
    try {
        const company = await requireCompanyByOwner(req.userId!);
        const disposition =
            req.query.disposition === "attachment" ? "attachment" : "inline";

        const { pdfBuffer, filename } = await generateDanfePdf(
            company,
            req.params.id,
            disposition,
        );

        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `${disposition}; filename="${filename}"`,
            "Content-Length": pdfBuffer.length.toString(),
        });
        res.send(pdfBuffer);
    } catch (err) {
        next(err);
    }
});
