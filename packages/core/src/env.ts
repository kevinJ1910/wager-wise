/**
 * Validación de variables de entorno.
 *
 * Falla al arrancar, con un mensaje que dice exactamente qué falta, en vez de
 * romper en mitad de una ingesta nocturna con un `undefined`.
 */

import { z } from 'zod';

const serverEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  API_FOOTBALL_KEY: z.string().min(10),
  ODDS_API_KEY: z.string().min(10),

  GEMINI_API_KEY: z.string().min(10),
  /**
   * El ID va en entorno a propósito: Google mantiene varios Flash estables a la
   * vez (3.5, 3.6, 3.7, 3.8) y los renombra con frecuencia. Un rename no debe
   * requerir un despliegue de código.
   */
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_MODEL_LIGHT: z.string().default('gemini-3.5-flash-lite'),
  /** Apaga la capa de IA sin tocar código: el resto de la app sigue funcionando. */
  GEMINI_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('true')
    .transform((v) => v === 'true'),

  /** Topes diarios del tier gratuito, para el guard de cuota. */
  API_FOOTBALL_DAILY_LIMIT: z.coerce.number().int().positive().default(100),
  ODDS_API_MONTHLY_LIMIT: z.coerce.number().int().positive().default(500),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  · ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas o ausentes:\n${problems}`);
  }

  return result.data;
}

const clientEnvSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.string().url(),
  /** Clave publicable (anon). Nunca la service role en el cliente. */
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function parseClientEnv(source: Record<string, string | undefined>): ClientEnv {
  const result = clientEnvSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  · ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Falta configuración del cliente. Copia .env.example a .env y rellena:\n${problems}`,
    );
  }

  return result.data;
}
