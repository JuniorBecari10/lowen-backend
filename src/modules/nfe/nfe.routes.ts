import { Router } from 'express';
import { z } from 'zod';
import { requireCompanyByOwner } from '../company/company.service.js';
import { Errors } from '../../shared/errors.js';

export const nfeRouter = Router();

nfeRouter.post('/nfe/import', async (req, res, next) => {
  try {
    await requireCompanyByOwner(req.userId!);
    // TODO (E3): receber XML (limite env.XML_MAX_BYTES), parsear com
    // fast-xml-parser (sem DTD/entidades externas), validar modelo 55 +
    // protocolo (nfeProc), calcular SHA-256, salvar bytes originais no
    // Storage privado `fiscal-documents`, extrair metadados/itens/impostos
    // e inserir em `nfe_documents` com unicidade
    // company_id + environment + access_key (idempotência).
    next(Errors.unprocessable('Importação de XML ainda não implementada (etapa E3).'));
  } catch (err) {
    next(err);
  }
});

const listQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  movement: z.enum(['ENTRY', 'EXIT', 'REVIEW']).optional(),
  number: z.string().optional(),
  counterpartyTaxId: z.string().optional(),
  accessKey: z.string().optional(),
  status: z.string().optional(),
  environment: z.enum(['homologacao', 'producao']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

nfeRouter.get('/nfe', async (req, res, next) => {
  try {
    const company = await requireCompanyByOwner(req.userId!);
    const query = listQuerySchema.parse(req.query);
    // TODO (E4): consultar `nfe_documents` filtrando por company.id + filtros
    // acima, com paginação no servidor (page/pageSize) e ordenação estável.
    res.json({ companyId: company.id, filters: query, items: [], total: 0 });
  } catch (err) {
    next(err);
  }
});

nfeRouter.get('/nfe/:id', async (req, res, next) => {
  try {
    await requireCompanyByOwner(req.userId!);
    // TODO (E4): buscar por id + company_id (nunca só por id).
    next(Errors.notFound('NF-e não encontrada.'));
  } catch (err) {
    next(err);
  }
});

nfeRouter.get('/nfe/:id/xml', async (req, res, next) => {
  try {
    await requireCompanyByOwner(req.userId!);
    // TODO (E4): recuperar XML do Storage privado, verificar disposition
    // (inline|attachment) e devolver com Content-Type application/xml.
    next(Errors.notFound('Documento não encontrado.'));
  } catch (err) {
    next(err);
  }
});

nfeRouter.get('/nfe/:id/events', async (req, res, next) => {
  try {
    await requireCompanyByOwner(req.userId!);
    // TODO: buscar eventos vinculados à mesma chave de acesso.
    res.json({ events: [] });
  } catch (err) {
    next(err);
  }
});
