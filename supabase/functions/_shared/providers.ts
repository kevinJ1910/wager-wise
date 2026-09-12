/**
 * Clientes de las APIs deportivas externas.
 *
 * Todas las respuestas pasan por zod. Un proveedor que cambia un campo tiene
 * que fallar aquí, ruidosamente y en la ingesta, no silenciosamente tres capas
 * más abajo dentro de una recomendación de apuesta.
 */

import { z } from 'npm:zod@4';

// ─────────────────────────────────────────────────────────────
// The Odds API · cuotas de varias casas
// ─────────────────────────────────────────────────────────────

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

const outcomeSchema = z.object({
  name: z.string(),
  price: z.number(),
  point: z.number().optional(),
});

const oddsEventSchema = z.object({
  id: z.string(),
  commence_time: z.string(),
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      last_update: z.string(),
      markets: z.array(
        z.object({
          key: z.string(),
          outcomes: z.array(outcomeSchema),
        }),
      ),
    }),
  ),
});

const oddsResponseSchema = z.array(oddsEventSchema);

export type OddsEvent = z.infer<typeof oddsEventSchema>;

export interface OddsApiOptions {
  apiKey: string;
  onCall: (endpoint: string, statusCode: number) => Promise<void>;
}

/**
 * Cuotas de una competición.
 *
 * El coste en créditos es `mercados × regiones`, así que la lista de mercados
 * se mantiene corta a propósito: con 500 créditos al mes, pedir cinco mercados
 * en tres regiones agota el presupuesto en una semana.
 */
export async function fetchOdds(
  sportKey: string,
  markets: string[],
  options: OddsApiOptions,
  regions = 'eu',
): Promise<OddsEvent[]> {
  const url = new URL(`${ODDS_API_BASE}/sports/${sportKey}/odds`);
  url.searchParams.set('apiKey', options.apiKey);
  url.searchParams.set('regions', regions);
  url.searchParams.set('markets', markets.join(','));
  url.searchParams.set('oddsFormat', 'decimal');
  url.searchParams.set('dateFormat', 'iso');

  const response = await fetch(url);
  await options.onCall(`/sports/${sportKey}/odds`, response.status);

  if (!response.ok) {
    throw new Error(`The Odds API respondió ${response.status}: ${await response.text()}`);
  }

  const parsed = oddsResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `Respuesta inesperada de The Odds API: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')
        .slice(0, 400)}`,
    );
  }

  return parsed.data;
}

/** Créditos que cuesta una llamada de cuotas. */
export function oddsCallCost(markets: string[], regions: string): number {
  return markets.length * regions.split(',').length;
}

// ─────────────────────────────────────────────────────────────
// Tipos de cambio
// ─────────────────────────────────────────────────────────────

const fxSchema = z.object({
  result: z.literal('success'),
  rates: z.record(z.string(), z.number()),
});

/**
 * Tasas frente al peso colombiano.
 *
 * open.er-api.com es gratuita y sin clave. Se guarda un snapshot diario: las
 * tasas sólo se usan para *presentar* importes, nunca para reconvertir el
 * bankroll, que vive siempre en su moneda de origen.
 */
export async function fetchFxRates(base = 'COP'): Promise<Record<string, number>> {
  const response = await fetch(`https://open.er-api.com/v6/latest/${base}`);
  if (!response.ok) throw new Error(`Tipos de cambio: ${response.status}`);

  const parsed = fxSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Respuesta inesperada del proveedor de tipos de cambio.');

  return parsed.data.rates;
}
