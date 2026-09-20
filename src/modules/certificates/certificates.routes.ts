import { Router } from 'express';
import { requireCompanyByOwner } from '../company/company.service.js';
import { Errors } from '../../shared/errors.js';

export const certificatesRouter = Router();

certificatesRouter.get('/certificate', async (req, res, next) => {
  try {
    const company = await requireCompanyByOwner(req.userId!);
    // TODO (E5): buscar em `certificates` por company.id + is_active,
    // devolvendo apenas metadados seguros (nunca storage_path/password_*).
    res.json({ companyId: company.id, certificate: null });
  } catch (err) {
    next(err);
  }
});

certificatesRouter.post('/certificate', async (req, res, next) => {
  try {
    await requireCompanyByOwner(req.userId!);
    // TODO (E5): multipart upload (limite env.CERTIFICATE_MAX_BYTES) ->
    // abrir PKCS#12 (node-forge) -> validar CNPJ/validade/par chave-certificado
    // -> encrypt() do infra/crypto para arquivo e senha, com AAD
    // `${companyId}:${certificateId}:pfx` / `:password` -> persistir só depois
    // que os dois armazenamentos (Storage + tabela) confirmarem sucesso.
    next(Errors.unprocessable('Upload de certificado ainda não implementado (etapa E5).'));
  } catch (err) {
    next(err);
  }
});

certificatesRouter.delete('/certificate', async (req, res, next) => {
  try {
    await requireCompanyByOwner(req.userId!);
    // TODO (E5): desativar registro, apagar arquivo/segredo cifrados,
    // preservar NF-e já importadas.
    next(Errors.unprocessable('Remoção de certificado ainda não implementada (etapa E5).'));
  } catch (err) {
    next(err);
  }
});
