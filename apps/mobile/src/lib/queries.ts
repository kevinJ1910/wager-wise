/**
 * Lectura del backend.
 *
 * Todo lo que sale de Supabase pasa por zod antes de llegar a una pantalla: un
 * `selection` guardado con una forma que el motor no entiende debe fallar aquí
 * —visible, en una sola selección— y no dentro de un cálculo de probabilidad.
 *
 * Las probabilidades no se recalculan en el cliente: `model_predictions` ya las
 * trae mezcladas por el backend. Lo único que sí se reconstruye aquí es la
 * matriz de marcadores, porque el builder la necesita para las conjuntas del
 * mismo partido y pesa menos traer el ajuste (un puñado de números por liga)
 * que la matriz entera de cada encuentro.
 */

import { selectionSchema } from '@wagerwise/core';
import {
  describeSelection,
  expectedGoals,
  matchResultProbabilities,
  scoreMatrix,
  type DixonColesModel,
  type Selection,
  type TeamRating,
} from '@wagerwise/engine';
import { useQuery } from '@tanstack/react-query';
import { isBackendConfigured, supabase } from './supabase.js';
import { formatKickoff, type FixtureAnalysis, type FixtureView, type MarketOffer } from './fixtures.js';
import { SAMPLE_FIXTURES, SAMPLE_LEAGUES, SAMPLE_MATRICES } from './sample-data.js';

/**
 * Hasta dónde mira la app.
 *
 * La misma ventana que ingiere el backend. Tiene que cubrir los parones de
 * selecciones: con un horizonte corto, tres semanas al año la app no tendría
 * ni un partido real que enseñar.
 */
const HORIZON_DAYS = 21;
const MAX_GOALS = 10;

export interface LiveFixtures {
  fixtures: FixtureView[];
  matrices: Map<string, number[][]>;
  leagues: string[];
}

// ─────────────────────────────────────────────────────────────
// Partidos próximos
// ─────────────────────────────────────────────────────────────

export function useLiveFixtures() {
  return useQuery({
    queryKey: ['fixtures', 'upcoming'],
    enabled: isBackendConfigured,
    queryFn: fetchUpcomingFixtures,
  });
}

async function fetchUpcomingFixtures(): Promise<LiveFixtures> {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);

  const { data, error } = await supabase
    .from('fixtures')
    .select(
      `id, kickoff_at, league_id,
       home:teams!fixtures_home_team_id_fkey(id, name),
       away:teams!fixtures_away_team_id_fkey(id, name),
       league:leagues!fixtures_league_id_fkey(id, name),
       predictions:model_predictions(
         selection, model_probability, market_probability, blended_probability,
         best_odds, best_bookmaker_id, edge, expected_value, computed_at
       )`,
    )
    .eq('status', 'scheduled')
    .gte('kickoff_at', now.toISOString())
    .lte('kickoff_at', horizon.toISOString())
    .order('kickoff_at', { ascending: true });

  if (error) throw new Error(`No se pudieron leer los partidos: ${error.message}`);

  const rows = (data ?? []) as unknown as FixtureRow[];
  if (rows.length === 0) return { fixtures: [], matrices: new Map(), leagues: [] };

  const models = await fetchModels([...new Set(rows.map((r) => r.league_id))]);

  const fixtures: FixtureView[] = [];
  const matrices = new Map<string, number[][]>();

  for (const row of rows) {
    const model = models.get(row.league_id);
    // Sin ajuste de la liga no hay matriz, y sin matriz no hay conjuntas ni
    // probabilidad del modelo: el partido se omite en vez de mostrarse a medias.
    if (!model || !model.ratings.has(row.home.id) || !model.ratings.has(row.away.id)) continue;

    const matrix = scoreMatrix(model, row.home.id, row.away.id, MAX_GOALS);
    const rates = expectedGoals(model, row.home.id, row.away.id);
    const markets = toMarkets(row);
    const kickoffAt = new Date(row.kickoff_at);
    const outcome = matchResultProbabilities(matrix);

    matrices.set(row.id, matrix);
    fixtures.push({
      id: row.id,
      league: row.league?.name ?? row.league_id,
      kickoff: formatKickoff(kickoffAt),
      kickoffAt,
      homeTeam: row.home.name,
      awayTeam: row.away.name,
      lambda: rates.lambda,
      mu: rates.mu,
      matrix,
      matchOdds: matchOddsFrom(markets),
      markets,
      // Desde -1 y no desde 0: si todos los mercados tienen EV negativo, eso es
      // lo que hay que enseñar, no un "+0,0%" que nadie calculó.
      bestEv: markets.reduce((max, m) => Math.max(max, m.expectedValue), -1),
      ...splitFrom(markets, outcome),
    });
  }

  fixtures.sort((a, b) => b.bestEv - a.bestEv);

  return {
    fixtures,
    matrices,
    leagues: [...new Set(fixtures.map((f) => f.league))],
  };
}

/**
 * Convierte las predicciones guardadas en ofertas de mercado.
 *
 * El backend inserta una fila por pasada, así que de una misma selección hay
 * varias versiones; nos quedamos con la más reciente. Una selección que no
 * valide se descarta con un aviso: es preferible una pantalla con un mercado
 * menos que una con un número en el que no se puede confiar.
 */
function toMarkets(row: FixtureRow): MarketOffer[] {
  const latest = new Map<string, { prediction: PredictionRow; selection: Selection }>();

  for (const prediction of row.predictions ?? []) {
    const parsed = selectionSchema.safeParse(prediction.selection);
    if (!parsed.success) {
      console.warn(`Selección ilegible en ${row.id}: ${parsed.error.issues[0]?.message ?? ''}`);
      continue;
    }

    const selection = parsed.data as Selection;
    const key = describeSelection(selection);
    const previous = latest.get(key);
    if (previous && previous.prediction.computed_at >= prediction.computed_at) continue;

    latest.set(key, { prediction, selection });
  }

  const markets: MarketOffer[] = [];

  for (const [label, { prediction, selection }] of latest) {
    // Sin cuota no hay ni ventaja ni EV que enseñar: la selección existe como
    // probabilidad, pero no como apuesta.
    if (prediction.best_odds === null) continue;

    markets.push({
      id: `${row.id}:${label}`,
      selection,
      label,
      odds: prediction.best_odds,
      modelProbability: prediction.model_probability,
      marketProbability: prediction.market_probability,
      blendedProbability: prediction.blended_probability,
      edge: prediction.edge ?? 0,
      expectedValue: prediction.expected_value ?? 0,
      bookmaker: prediction.best_bookmaker_id ?? undefined,
    });
  }

  return markets.sort((a, b) => b.expectedValue - a.expectedValue);
}

/**
 * El reparto 1X2 que se enseña: el de la mezcla calibrada si el backend guardó
 * las tres selecciones, el del modelo si no.
 */
function splitFrom(
  markets: MarketOffer[],
  model: { home: number; draw: number; away: number },
): Pick<FixtureView, 'split' | 'splitSource'> {
  const find = (outcome: 'home' | 'draw' | 'away'): number | undefined =>
    markets.find((m) => m.selection.kind === 'match_result' && m.selection.outcome === outcome)
      ?.blendedProbability;

  const home = find('home');
  const draw = find('draw');
  const away = find('away');

  return home !== undefined && draw !== undefined && away !== undefined
    ? { split: { home, draw, away }, splitSource: 'estimate' }
    : { split: model, splitSource: 'model' };
}

/** Las tres cuotas del 1X2, sólo si el mercado completo está publicado. */
function matchOddsFrom(markets: MarketOffer[]): [number, number, number] | null {
  const find = (outcome: 'home' | 'draw' | 'away'): number | undefined =>
    markets.find((m) => m.selection.kind === 'match_result' && m.selection.outcome === outcome)
      ?.odds;

  const home = find('home');
  const draw = find('draw');
  const away = find('away');

  return home && draw && away ? [home, draw, away] : null;
}

// ─────────────────────────────────────────────────────────────
// Ajuste del modelo
// ─────────────────────────────────────────────────────────────

async function fetchModels(leagueIds: string[]): Promise<Map<string, DixonColesModel>> {
  const [fits, ratings] = await Promise.all([
    supabase
      .from('model_fits')
      .select('league_id, home_advantage, rho, base_rate, sample_size')
      .in('league_id', leagueIds),
    supabase
      .from('team_ratings')
      .select('league_id, team_id, attack, defence')
      .in('league_id', leagueIds),
  ]);

  if (fits.error) throw new Error(`No se pudo leer el ajuste: ${fits.error.message}`);
  if (ratings.error) throw new Error(`No se pudieron leer los ratings: ${ratings.error.message}`);

  const byLeague = new Map<string, Map<string, TeamRating>>();
  for (const rating of (ratings.data ?? []) as RatingRow[]) {
    const bucket = byLeague.get(rating.league_id) ?? new Map<string, TeamRating>();
    bucket.set(rating.team_id, {
      teamId: rating.team_id,
      attack: rating.attack,
      defence: rating.defence,
    });
    byLeague.set(rating.league_id, bucket);
  }

  const models = new Map<string, DixonColesModel>();
  for (const fit of (fits.data ?? []) as FitRow[]) {
    models.set(fit.league_id, {
      ratings: byLeague.get(fit.league_id) ?? new Map(),
      homeAdvantage: fit.home_advantage,
      rho: fit.rho,
      baseRate: fit.base_rate,
      sampleSize: fit.sample_size,
    });
  }

  return models;
}

// ─────────────────────────────────────────────────────────────
// Fuente efectiva: real si la hay, muestra si no
// ─────────────────────────────────────────────────────────────

export type DataSource = 'live' | 'sample';

export interface FixtureData extends LiveFixtures {
  source: DataSource;
  isLoading: boolean;
  error: Error | null;
  /** True cuando hay backend pero todavía no hay partidos por jugar. */
  emptySchedule: boolean;
}

/**
 * Lo que consumen las pantallas.
 *
 * Con backend configurado y partidos en la ventana, datos reales. Si no hay
 * partidos —un parón de selecciones deja tres semanas sin nada— se cae a los
 * datos de muestra, pero diciéndolo: `source` llega hasta el banner para que
 * la pantalla nunca los presente como reales.
 */
export function useFixtureData(): FixtureData {
  const query = useLiveFixtures();
  const live = query.data;
  const hasLive = Boolean(live && live.fixtures.length > 0);

  if (hasLive) {
    return {
      ...live!,
      source: 'live',
      isLoading: false,
      error: null,
      emptySchedule: false,
    };
  }

  return {
    fixtures: SAMPLE_FIXTURES,
    matrices: new Map(SAMPLE_MATRICES),
    leagues: SAMPLE_LEAGUES,
    source: 'sample',
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    emptySchedule: isBackendConfigured && !query.isLoading && !hasLive && !query.error,
  };
}

// ─────────────────────────────────────────────────────────────
// Razonamiento de la IA
// ─────────────────────────────────────────────────────────────

export function useFixtureAnalyses(fixtureId: string | undefined) {
  return useQuery({
    queryKey: ['analyses', fixtureId],
    enabled: isBackendConfigured && Boolean(fixtureId),
    queryFn: () => fetchAnalyses(fixtureId!),
  });
}

async function fetchAnalyses(fixtureId: string): Promise<FixtureAnalysis[]> {
  const { data, error } = await supabase
    .from('ai_analyses')
    .select('id, fixture_id, selection, reasoning, facts, confidence, veto, veto_reason, model, created_at')
    .eq('fixture_id', fixtureId)
    .order('created_at', { ascending: false })
    .limit(6);

  if (error) throw new Error(`No se pudo leer el análisis: ${error.message}`);

  return ((data ?? []) as AnalysisRow[]).map((row) => ({
    id: row.id,
    fixtureId: row.fixture_id,
    reasoning: row.reasoning,
    facts: Array.isArray(row.facts) ? row.facts.filter(isFact) : [],
    confidence: row.confidence,
    veto: row.veto,
    vetoReason: row.veto_reason,
    model: row.model,
  }));
}

function isFact(value: unknown): value is { label: string; value: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { label?: unknown }).label === 'string' &&
    typeof (value as { value?: unknown }).value === 'string'
  );
}

// ─────────────────────────────────────────────────────────────
// Filas tal como llegan de PostgREST
// ─────────────────────────────────────────────────────────────

interface PredictionRow {
  selection: unknown;
  model_probability: number;
  market_probability: number;
  blended_probability: number;
  best_odds: number | null;
  best_bookmaker_id: string | null;
  edge: number | null;
  expected_value: number | null;
  computed_at: string;
}

interface FixtureRow {
  id: string;
  kickoff_at: string;
  league_id: string;
  home: { id: string; name: string };
  away: { id: string; name: string };
  league: { id: string; name: string } | null;
  predictions: PredictionRow[] | null;
}

interface FitRow {
  league_id: string;
  home_advantage: number;
  rho: number;
  base_rate: number;
  sample_size: number;
}

interface RatingRow {
  league_id: string;
  team_id: string;
  attack: number;
  defence: number;
}

interface AnalysisRow {
  id: string;
  fixture_id: string;
  selection: unknown;
  reasoning: string;
  facts: unknown[];
  confidence: number | null;
  veto: boolean;
  veto_reason: string | null;
  model: string;
  created_at: string;
}
