import { Router } from "express";
import { requireCompanyByOwner } from "../company/company.service.js";
import { Errors } from "../../shared/errors.js";
import multer from "multer";
import {
    getCertificateMetadata,
    parseAndValidatePkcs12,
    saveCertificate,
    deleteCertificate,
} from "./certificates.service.js";

export const certificatesRouter = Router();

// Multer para upload de certificado PFX (memory storage)
const uploadCert = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (_req, file, cb) => {
        const allowedTypes = [
            "application/x-pkcs12",
            "application/pkcs12",
            "application/octet-stream",
        ];
        const allowedExts = [".pfx", ".p12"];
        const isAllowedType = allowedTypes.includes(file.mimetype);
        const isAllowedExt = allowedExts.some((ext) =>
            file.originalname.toLowerCase().endsWith(ext),
        );
        if (isAllowedType || isAllowedExt) {
            cb(null, true);
        } else {
            cb(new Error("Apenas arquivos PFX/P12 são permitidos."));
        }
    },
});

// GET /certificate - Buscar metadados do certificado ativo
certificatesRouter.get("/certificate", async (req, res, next) => {
    try {
        const company = await requireCompanyByOwner(req.userId!);
        const certificate = await getCertificateMetadata(company);
        res.json({ companyId: company.id, certificate });
    } catch (err) {
        next(err);
    }
});

// POST /certificate - Upload e validação de certificado A1 (PFX)
certificatesRouter.post(
    "/certificate",
    uploadCert.single("certificate"),
    async (req, res, next) => {
        try {
            const company = await requireCompanyByOwner(req.userId!);

            if (!req.file) {
                return next(
                    Errors.invalidInput(
                        "Arquivo PFX é obrigatório (campo 'certificate').",
                    ),
                );
            }

            const password = req.body.password;
            if (!password || typeof password !== "string") {
                return next(
                    Errors.invalidInput("Senha do certificado é obrigatória."),
                );
            }

            // Parsear e validar PKCS#12
            const parsed = await parseAndValidatePkcs12(
                req.file.buffer,
                password,
            );

            // Verificar se o CNPJ do certificado bate com o da empresa
            if (parsed.taxId !== company.tax_id) {
                return next(
                    Errors.unprocessable(
                        `CNPJ do certificado (${parsed.taxId}) não confere com o da empresa (${company.tax_id}).`,
                    ),
                );
            }

            // Salvar certificado (cifrado no Storage + metadados na tabela)
            const certificateId = await saveCertificate(company, parsed);

            res.status(201).json({
                certificateId,
                message: "Certificado importado e validado com sucesso.",
                subjectName: parsed.subjectName,
                validFrom: parsed.validFrom.toISOString(),
                validTo: parsed.validTo.toISOString(),
            });
        } catch (err) {
            next(err);
        }
    },
);

// DELETE /certificate - Remover certificado ativo
certificatesRouter.delete("/certificate", async (req, res, next) => {
    try {
        const company = await requireCompanyByOwner(req.userId!);
        await deleteCertificate(company);
        res.json({ message: "Certificado desativado e arquivos removidos." });
    } catch (err) {
        next(err);
    }
});
