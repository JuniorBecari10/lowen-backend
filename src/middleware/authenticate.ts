import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { Errors } from '../shared/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      accessToken?: string;
    }
  }
}

// createRemoteJWKSet mantém um cache interno das chaves e as renova sozinho
// quando o `kid` do token não bate com nenhuma já baixada -- não recriar
// isto por requisição.
const jwks = createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL));

/**
 * Verifica o JWT do Supabase localmente contra o JWKS do projeto (chaves de
 * assinatura assimétricas), sem round-trip ao serviço de Auth a cada
 * requisição. Em caso de sucesso, popula req.userId (claim `sub`) e
 * req.accessToken. A resolução da empresa a partir do userId acontece em
 * cada módulo, nunca a partir de um company_id enviado pelo cliente.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(Errors.unauthenticated());
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      // Supabase emite tokens com issuer `${SUPABASE_URL}/auth/v1` e
      // audience `authenticated`; ajuste aqui se o projeto usar outro valor.
      issuer: `${env.SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
    });

    if (typeof payload.sub !== 'string') {
      return next(Errors.unauthenticated());
    }

    req.userId = payload.sub;
    req.accessToken = token;
    next();
  } catch {
    next(Errors.unauthenticated());
  }
}
