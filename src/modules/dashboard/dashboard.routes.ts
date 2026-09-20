import { Router } from 'express';
import { requireCompanyByOwner } from '../company/company.service.js';

export const dashboardRouter = Router();

dashboardRouter.get('/dashboard', async (req, res, next) => {
  try {
    const company = await requireCompanyByOwner(req.userId!);
    // TODO (E4): agregar `nfe_documents` elegíveis (situação conhecida,
    // XML completo, movimento definido) por período/ambiente, separando
    // ICMS/DIFAL/FCP em três totais independentes com indicação de
    // cobertura (ex. "18 de 20 notas com valor legível").
    res.json({
      companyId: company.id,
      totals: { entriesAmount: null, exitsAmount: null },
      taxes: { icms: null, difalDest: null, fcpDest: null },
      coverage: null,
    });
  } catch (err) {
    next(err);
  }
});
