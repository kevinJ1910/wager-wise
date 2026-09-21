/**
 * Cliente de football-data.org.
 *
 * API-Football es gratis pero su plan free bloquea la temporada en curso
 * ("Free plans do not have access to this season"); football-data.org es lo
 * contrario: dentro de las 12 competiciones de su tier gratuito (La Liga y
 * Premier League incluidas) da la temporada en curso completa, partidos
 * jugados y por jugar, en un único endpoint. Por eso cubre tanto el
 * calendario próximo como el histórico reciente que necesita Dixon-Coles.
 *
 * Límite del tier gratuito: 10 peticiones/minuto. No hay tope diario, pero
 * se registra en `api_usage_log` igual que los demás proveedores para tener
 * un rastro y poder cortar si algo empieza a llamar en bucle.
 */

import { z } from 'npm:zod@4';

const BASE = 'https://api.football-data.org/v4';

const teamSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  crest: z.string().nullable().optional(),
});

const matchSchema = z.object({
  id: z.number().int(),
  utcDate: z.string(),
  status: z.string(),
  matchday: z.number().int().nullable().optional(),
  homeTeam: teamSchema,
  awayTeam: teamSchema,
  score: z.object({
    fullTime: z.object({
      home: z.number().int().nullable(),
      away: z.number().int().nullable(),
    }),
  }),
});

const matchesResponseSchema = z.object({
  matches: z.array(matchSchema),
});

export type FootballDataMatch = z.infer<typeof matchSchema>;

/** Traduce el estado de football-data.org al enum del esquema propio. */
export function mapMatchStatus(
  status: string,
): 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled' {
  if (status === 'FINISHED') return 'finished';
  if (['IN_PLAY', 'PAUSED'].includes(status)) return 'live';
  if (status === 'POSTPONED') return 'postponed';
  if (['SUSPENDED', 'CANCELLED'].includes(status)) return 'cancelled';
  return 'scheduled';
}

export interface FootballDataOptions {
  apiKey: string;
  onCall: (endpoint: string, statusCode: number) => Promise<void>;
}

/** Partidos de una competición en un rango de fechas (YYYY-MM-DD), sin filtrar por estado. */
export async function fetchMatches(
  competitionCode: string,
  from: string,
  to: string,
  options: FootballDataOptions,
): Promise<FootballDataMatch[]> {
  const path = `/competitions/${competitionCode}/matches`;
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('dateFrom', from);
  url.searchParams.set('dateTo', to);

  const response = await fetch(url, { headers: { 'X-Auth-Token': options.apiKey } });
  await options.onCall(path, response.status);

  if (!response.ok) {
    throw new Error(
      `football-data.org ${path} respondió ${response.status}: ${await response.text()}`,
    );
  }

  const parsed = matchesResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `Respuesta inesperada de football-data.org ${path}: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')
        .slice(0, 400)}`,
    );
  }

  return parsed.data.matches;
}

/**
 * Temporada completa de una competición.
 *
 * Los rangos de fecha y el filtro de temporada no se combinan en esta API, así
 * que va como llamada aparte. Se usa para el histórico del modelo: con sólo la
 * temporada en curso, en septiembre cada equipo lleva ocho o nueve partidos y
 * un ajuste con cuarenta parámetros libres sobre esa muestra se sobreajusta sin
 * remedio.
 */
export async function fetchSeason(
  competitionCode: string,
  season: number,
  options: FootballDataOptions,
): Promise<FootballDataMatch[]> {
  const path = `/competitions/${competitionCode}/matches`;
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('season', String(season));

  const response = await fetch(url, { headers: { 'X-Auth-Token': options.apiKey } });
  await options.onCall(`${path}?season`, response.status);

  if (!response.ok) {
    throw new Error(
      `football-data.org ${path} (temporada ${season}) respondió ${response.status}: ${await response.text()}`,
    );
  }

  const parsed = matchesResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(
      `Respuesta inesperada de football-data.org ${path}: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')
        .slice(0, 400)}`,
    );
  }

  return parsed.data.matches;
}

/**
 * Temporada a la que pertenece una fecha.
 *
 * Las ligas europeas cruzan el año natural: agosto de 2026 y mayo de 2027 son
 * la misma temporada, la "2026" para esta API.
 */
export function seasonOf(date: Date): number {
  const year = date.getUTCFullYear();
  return date.getUTCMonth() >= 6 ? year : year - 1;
}
