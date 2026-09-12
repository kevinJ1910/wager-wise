/**
 * Guard de cuota.
 *
 * El plan se apoya en los tiers gratuitos: 100 peticiones/día en API-Football y
 * 500 créditos/mes en The Odds API. Agotarlos a mitad de mes deja la app sin
 * datos, así que cada llamada se contabiliza y se comprueba el presupuesto
 * ANTES de gastarla.
 */

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type Provider = 'api-football' | 'the-odds-api' | 'gemini';

export class QuotaExceededError extends Error {
  constructor(
    readonly provider: Provider,
    readonly used: number,
    readonly limit: number,
  ) {
    super(
      `Cuota agotada para ${provider}: ${used}/${limit}. ` +
        'La ingesta se detiene para no dejar la app sin datos el resto del periodo.',
    );
    this.name = 'QuotaExceededError';
  }
}

/** Consumo del periodo vigente: día natural UTC, o mes para The Odds API. */
export async function usageInPeriod(
  supabase: SupabaseClient,
  provider: Provider,
): Promise<number> {
  const since = periodStart(provider);

  const { data, error } = await supabase
    .from('api_usage_log')
    .select('cost')
    .eq('provider', provider)
    .gte('called_at', since.toISOString());

  if (error) throw new Error(`No se pudo leer el consumo de ${provider}: ${error.message}`);

  return (data ?? []).reduce((sum, row) => sum + (row.cost as number), 0);
}

/**
 * Comprueba que quedan créditos y devuelve una función para registrar el gasto.
 *
 * Se registra después de la llamada y con el código de estado real, para que el
 * log refleje lo que de verdad consumió el proveedor.
 */
export async function reserveQuota(
  supabase: SupabaseClient,
  provider: Provider,
  cost: number,
  limit: number,
): Promise<(endpoint: string, statusCode: number) => Promise<void>> {
  const used = await usageInPeriod(supabase, provider);

  if (used + cost > limit) {
    throw new QuotaExceededError(provider, used, limit);
  }

  return async (endpoint: string, statusCode: number) => {
    const { error } = await supabase
      .from('api_usage_log')
      .insert({ provider, endpoint, cost, status_code: statusCode });

    // Un fallo al registrar no debe tumbar la ingesta, pero sí avisar: sin log
    // el guard deja de proteger.
    if (error) console.error(`No se pudo registrar el uso de ${provider}: ${error.message}`);
  };
}

function periodStart(provider: Provider): Date {
  const now = new Date();

  // The Odds API factura por mes natural; los demás se controlan por día.
  if (provider === 'the-odds-api') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Marca el inicio de un job y devuelve cómo cerrarlo. */
export async function trackRun(
  supabase: SupabaseClient,
  job: string,
): Promise<(status: 'ok' | 'failed', detail?: unknown) => Promise<void>> {
  const { data, error } = await supabase
    .from('ingestion_runs')
    .insert({ job, status: 'running' })
    .select('id')
    .single();

  if (error) console.error(`No se pudo abrir la traza de ${job}: ${error.message}`);
  const runId = data?.id as number | undefined;

  return async (status, detail) => {
    if (runId === undefined) return;
    await supabase
      .from('ingestion_runs')
      .update({
        status,
        detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail)),
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
  };
}
