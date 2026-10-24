import { Router } from "express";
import { z } from "zod";
import { requireCompanyByOwner } from "../company/company.service.js";
import { Errors } from "../../shared/errors.js";
import multer from "multer";
import {
  parseNfeXml,
  storeXmlInStorage,
  upsertNfeDocument,
  listNfeDocuments,
  getNfeDocumentById,
  getXmlFromStorage,
  getNfeEvents,
} from "./nfe.service.js";

interface NfeDocument {
  id: string;
  xml_path: string | null;
  access_key: string;
  environment: "homologacao" | "producao";
  // other properties exist but we only need these for the routes
  [key: string]: unknown;
}

export const nfeRouter = Router();

// Multer para upload de XML (apenas memory storage, limite em bytes)
const uploadXml = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB, env.XML_MAX_BYTES é validado no service
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/xml" || file.mimetype === "text/xml") {
      cb(null, true);
    } else {
      cb(new Error("Apenas arquivos XML são permitidos."));
    }
  },
});

// POST /nfe/import - Importar XML de NF-e
nfeRouter.post("/nfe/import", uploadXml.single("xml"), async (req, res, next) => {
  try {
    const company = await requireCompanyByOwner(req.userId!);

    if (!req.file) {
      return next(Errors.invalidInput("Arquivo XML é obrigatório (campo 'xml')."));
    }

    const environment = (req.query.environment as "homologacao" | "producao") ?? "producao";
    if (!["homologacao", "producao"].includes(environment)) {
      return next(Errors.invalidInput("Environment deve ser 'homologacao' ou 'producao'."));
    }

    // Parsear e validar XML
    const parsed = await parseNfeXml(req.file.buffer);

    // Armazenar XML original no Storage
    const xmlPath = await storeXmlInStorage(
      company.id,
      parsed.metadata.accessKey,
      parsed.xmlBytes,
      environment,
    );

    // Persistir na tabela com idempotência
    const result = await upsertNfeDocument(company, environment, parsed, xmlPath);

    res.status(result.isNew ? 201 : 200).json({
      nfeId: result.id,
      accessKey: parsed.metadata.accessKey,
      isNew: result.isNew,
      message: result.isNew ? "NF-e importada com sucesso." : "NF-e já existia, dados atualizados.",
    });
  } catch (err) {
    next(err);
  }
});

const listQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  movement: z.enum(["ENTRY", "EXIT", "REVIEW"]).optional(),
  number: z.string().optional(),
  counterpartyTaxId: z.string().optional(),
  accessKey: z.string().optional(),
  status: z.string().optional(),
  environment: z.enum(["homologacao", "producao"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// GET /nfe - Listar NF-es com filtros e paginação
nfeRouter.get("/nfe", async (req, res, next) => {
  try {
    const company = await requireCompanyByOwner(req.userId!);
    const query = listQuerySchema.parse(req.query);

    const result = await listNfeDocuments(company, query);

    res.json({
      companyId: company.id,
      filters: query,
      items: result.items,
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (err) {
    next(err);
  }
});

// GET /nfe/:id - Buscar NF-e por ID
nfeRouter.get("/nfe/:id", async (req, res, next) => {
  try {
    const company = await requireCompanyByOwner(req.userId!);
    const nfe = await getNfeDocumentById(company, req.params.id);

    if (!nfe) {
      return next(Errors.notFound("NF-e não encontrada."));
    }

    res.json({ nfe });
  } catch (err) {
    next(err);
  }
});

// GET /nfe/:id/xml - Recuperar XML original do Storage
nfeRouter.get("/nfe/:id/xml", async (req, res, next) => {
  try {
    const company = await requireCompanyByOwner(req.userId!);
    const nfe = await getNfeDocumentById(company, req.params.id);

    if (!nfe || !(nfe as NfeDocument).xml_path) {
      return next(Errors.notFound("Documento não encontrado."));
    }

    const nfeDoc = nfe as NfeDocument;
    const disposition = req.query.disposition === "attachment" ? "attachment" : "inline";
    const xmlBytes = await getXmlFromStorage(nfeDoc.xml_path!);

    res.set({
      "Content-Type": "application/xml",
      "Content-Disposition": `${disposition}; filename="${nfeDoc.access_key}.xml"`,
      "Content-Length": xmlBytes.length.toString(),
    });
    res.send(xmlBytes);
  } catch (err) {
    next(err);
  }
});

// GET /nfe/:id/events - Buscar eventos da NF-e
nfeRouter.get("/nfe/:id/events", async (req, res, next) => {
  try {
    const company = await requireCompanyByOwner(req.userId!);
    const nfe = await getNfeDocumentById(company, req.params.id);

    if (!nfe) {
      return next(Errors.notFound("NF-e não encontrada."));
    }

    const nfeDoc = nfe as NfeDocument;
    const events = await getNfeEvents(company, nfeDoc.access_key, nfeDoc.environment);

    res.json({ events });
  } catch (err) {
    next(err);
  }
});