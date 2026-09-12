/**
 * Clientes de las APIs deportivas externas.
 *
 * Todas las respuestas pasan por zod. Un proveedor que cambia un campo tiene
 * que fallar aquí, ruidosamente y en la ingesta, no silenciosamente tres capas
 * más abajo dentro de una recomendación de apuesta.
 */

import { z } from 'npm:zod@4';

// ─────────────────────────────────────────────────────────────
// API-Football (api-sports.io) · fixtures, resultados, equipos
// ─────────────────────────────────────────────────────────────

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

const teamSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  logo: z.string().nullable().optional(),
});

const fixtureItemSchema = z.object({
  fixture: z.object({
    id: z.number().int(),
    date: z.string(),
    status: z.object({ short: z.string() }),
  }),
  league: z.object({
    id: z.number().int(),
    name: z.string(),
    country: z.string().nullable().optional(),
    season: z.number().int(),
    round: z.string().nullable().optional(),
  }),
  teams: z.object({ home: teamSchema, away: teamSchema }),
  goals: z.object({
    home: z.number().int().nullable(),
    away: z.number().int().nullable(),
  }),
});

const fixturesResponseSchema = z.object({
  // La API devuelve `errors` como array vacío cuando todo va bien y como objeto
  // cuando falla: hay que aceptar ambas formas para poder leer el mensaje.
  errors: z.union([z.array(z.unknown()), z.record(z.string(), z.string())]),
  results: z.number().int(),
  response: z.array(fixtureItemSchema),
});

export type ApiFootballFixture = z.infer<typeof fixtureItemSchema>;

/** Traduce el estado corto de API-Football al enum del esquema. */
export function mapFixtureStatus(short: string): 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled' {
  if (['FT', 'AET', 'PEN'].includes(short)) return 'finished';
  if (['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(short)) return 'live';
  if (['PST'].includes(short)) return 'postponed';
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(short)) return 'cancelled';
  return 'scheduled';
}

export interface ApiFootballOptions {
  apiKey: string;
  onCall: (endpoint: string, statusCode: number) => Promise<void>;
}

async function apiFootballGet(
  path: string,
  params: Record<string, string>,
  options: ApiFootballOptions,
): Promise<unknown> {
  const url = new URL(`${API_FOOTBALL_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, { headers: { 'x-apisports-key': options.apiKey } });
  await options.onCall(path, response.status);

  if (!response.ok) {
    throw new Error(`API-Football ${path} respondió ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

/** Partidos de una liga en un rango de fechas (formato YYYY-MM-DD). */
export async function fetchFixtures(
  leagueId: number,
  season: number,
  from: string,
  to: string,
  options: ApiFootballOptions,
): Promise<ApiFootballFixture[]> {
  const raw = await apiFootballGet(
    '/fixtures',
    { league: String(leagueId), season: String(season), from, to, timezone: 'UTC' },
    options,
  );

  const parsed = fixturesResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Respuesta inesperada de API-Football /fixtures: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')
        .slice(0, 400)}`,
    );
  }

  const { errors } = parsed.data;
  if (!Array.isArray(errors) && Object.keys(errors).length > 0) {
    throw new Error(`API-Football devolvió errores: ${JSON.stringify(errors)}`);
  }

  return parsed.data.response;
}

/** Resultados ya terminados de una temporada, para ajustar el modelo. */
export async function fetchSeasonResults(
  leagueId: number,
  season: number,
  options: ApiFootballOptions,
): Promise<ApiFootballFixture[]> {
  const raw = await apiFootballGet(
    '/fixtures',
    { league: String(leagueId), season: String(season), status: 'FT-AET-PEN', timezone: 'UTC' },
    options,
  );

  const parsed = fixturesResponseSchema.parse(raw);
  return parsed.response;
}

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
