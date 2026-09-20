import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

/**
 * Cliente com a chave publishable (client-safe). Não usamos este cliente
 * para autenticar requisições no backend -- a verificação do JWT é feita
 * localmente via JWKS em middleware/authenticate.ts, sem round-trip ao
 * serviço de Auth. Este cliente serve apenas se algum fluxo pontual
 * precisar chamar a API pública do Supabase (ex. reenviar e-mail de
 * confirmação) em nome do próprio backend.
 */
export const supabasePublicClient = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Cliente administrativo com a secret key: ignora RLS.
 * Todo uso deste cliente para tabelas de negócio DEVE filtrar explicitamente
 * por company_id resolvido a partir do usuário autenticado — nunca a partir
 * de um valor recebido do cliente HTTP.
 */
export const supabaseAdminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Cria um cliente escopado ao token do usuário, para operações de leitura
 * comuns que devem respeitar RLS diretamente no Postgres.
 */
export function createUserScopedClient(accessToken: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
