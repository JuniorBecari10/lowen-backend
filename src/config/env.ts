import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3333),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  SUPABASE_JWKS_URL: z.string().url(),

  CERT_MASTER_KEY_BASE64: z.string().min(1),
  CERT_MASTER_KEY_VERSION: z.coerce.number().default(1),

  CERTIFICATE_MAX_BYTES: z.coerce.number().default(2 * 1024 * 1024),
  XML_MAX_BYTES: z.coerce.number().default(5 * 1024 * 1024),

  SEFAZ_ENVIRONMENT: z.enum(['homologacao', 'producao']).default('homologacao'),
});

// Falha rápido: se alguma variável obrigatória estiver ausente, o processo não sobe.
export const env = envSchema.parse(process.env);
