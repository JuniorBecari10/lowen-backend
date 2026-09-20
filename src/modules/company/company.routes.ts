import { Router } from 'express';
import { z } from 'zod';
import { createCompany, getCompanyByOwner } from './company.service.js';

export const companyRouter = Router();

companyRouter.get('/company', async (req, res, next) => {
  try {
    const company = await getCompanyByOwner(req.userId!);
    res.json({ company });
  } catch (err) {
    next(err);
  }
});

const createCompanySchema = z.object({
  taxId: z.string().regex(/^[0-9]{14}$/, 'CNPJ deve ter 14 dígitos.'),
  legalName: z.string().min(1).max(200),
  uf: z.string().length(2),
});

companyRouter.post('/company', async (req, res, next) => {
  try {
    const input = createCompanySchema.parse(req.body);
    const company = await createCompany(req.userId!, input);
    res.status(201).json({ company });
  } catch (err) {
    next(err);
  }
});
