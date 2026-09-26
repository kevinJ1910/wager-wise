/**
 * Backtesting semanal y calibración de `w`.
 *
 * Reproduce el motor sobre cada partido ya jugado que tenga cuotas históricas:
 * reajusta Dixon-Coles con lo jugado antes de ese día, lo mezcla con el
 * consenso de las cuotas previas y puntúa el resultado. El `w` que minimiza la
 * log loss se guarda en `model_calibrations`, y `generate-parlays` lo usa en
 * lugar del 0.35 inicial —que siempre fue una conjetura razonable, no un dato.
 *
 * No llama a ninguna API: lee `fixtures` e `historical_odds`.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  buildBacktestEvents,
  calibrateModelWeight,
  scoreEvents,
  simulateBetting,
  type BacktestEvent,
  type BacktestFixture,
  type LeagueMatch,
  type MarketQuotes,
} from '../../../packages/engine/dist/index.js';
import { commissionOf } from '../_shared/exchanges.ts';
import { LEAGUES, leagueId } from '../_shared/leagues.ts';
import { trackRun } from '../_shared/quota.ts';

/** El peso con el que arrancó el producto, antes de tener datos. */
const DEFAULT_WEIGHT = 0.35;

/**
 * Muestra mínima para que generate-parlays use el peso calibrado. Por debajo,
 * la curva de log loss es tan plana y ruidosa que el mínimo puede caer en
 * cualquier sitio, y es mejor seguir con el valor por defecto.
 */
const MIN_FIXTURES_TO_APPLY = 300;

const EDGE_THRESHOLDS = [0.02, 0.04, 0.06, 0.08];

/** Dos temporadas, igual que el ajuste diario del modelo. */
const LOOKBACK_DAYS = 730;

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const finishRun = await trackRun(supabase, 'backtest');

  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const history = await fetchHistory(supabase, since);
    const odds = await fetchHistoricalOdds(supabase, since);

    const fixtures: BacktestFixture[] = [];
    for (const match of history) {
      const quotes = odds.get(match.fixtureId);
      if (quotes) fixtures.push({ ...match, ...quotes });
    }

    const { events, skipped } = buildBacktestEvents(fixtures, history);

    if (events.length === 0) {
      const summary = { fixtures: fixtures.length, events: 0, note: 'Sin eventos puntuables todavía.' };
      await finishRun('ok', summary);
      return json(summary);
    }

    const calibration = calibrateModelWeight(events);
    const scoredFixtures = new Set(events.map((event) => event.fixtureId)).size;
    const applied = scoredFixtures >= MIN_FIXTURES_TO_APPLY;

    const metrics = {
      curve: calibration.curve,
      improvementOverMarket: calibration.improvementOverMarket,
      standardError: calibration.standardError,
      defaultWeight: DEFAULT_WEIGHT,
      byMarket: {
        match_result: compare(events.filter((e) => e.kind === 'match_result'), calibration.weight),
        total_goals_2_5: compare(events.filter((e) => e.kind === 'total_goals_2_5'), calibration.weight),
      },
      byLeague: LEAGUES.map((league) => ({
        leagueId: leagueId(league),
        name: league.name,
        ...compare(events.filter((e) => e.leagueId === leagueId(league)), calibration.weight),
      })).filter((row) => row.events > 0),
      betting: {
        calibrated: EDGE_THRESHOLDS.map((t) => simulateBetting(events, calibration.weight, t)),
        default: EDGE_THRESHOLDS.map((t) => simulateBetting(events, DEFAULT_WEIGHT, t)),
      },
      skipped: countReasons(skipped.map((s) => s.reason)),
    };

    const { error } = await supabase.from('model_calibrations').insert({
      model_weight: calibration.weight,
      applied,
      fixtures: scoredFixtures,
      events: events.length,
      window_from: events[0]!.kickoff,
      window_to: events[events.length - 1]!.kickoff,
      metrics,
    });
    if (error) throw new Error(`No se pudo guardar la calibración: ${error.message}`);

    const summary = {
      fixtures: scoredFixtures,
      events: events.length,
      weight: calibration.weight,
      applied,
      improvementOverMarket: calibration.improvementOverMarket,
      standardError: calibration.standardError,
      skipped: skipped.length,
    };

    await finishRun('ok', summary);
    return json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun('failed', { message });
    return json({ error: message }, 500);
  }
});

/** Modelo solo, mercado solo y mezcla calibrada, sobre los mismos eventos. */
function compare(events: BacktestEvent[], weight: number) {
  return {
    events: events.length,
    model: scoreEvents(events, 1),
    market: scoreEvents(events, 0),
    blend: scoreEvents(events, weight),
  };
}

function countReasons(reasons: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reason of reasons) {
    // "sólo 12 partidos previos" y "sólo 30 partidos previos" son el mismo motivo.
    const key = reason.replace(/\d+/g, 'N');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

type HistoryMatch = LeagueMatch & { fixtureId: string };

/** Todos los partidos terminados: son a la vez el histórico y los candidatos. */
async function fetchHistory(supabase: SupabaseClient, since: string): Promise<HistoryMatch[]> {
  const matches: HistoryMatch[] = [];

  for (const league of LEAGUES) {
    const rows = await fetchAll<{
      id: string;
      league_id: string;
      home_team_id: string;
      away_team_id: string;
      home_goals: number | null;
      away_goals: number | null;
      kickoff_at: string;
    }>((from, to) =>
      supabase
        .from('fixtures')
        .select('id, league_id, home_team_id, away_team_id, home_goals, away_goals, kickoff_at')
        .eq('league_id', leagueId(league))
        .eq('status', 'finished')
        .gte('kickoff_at', since)
        .order('kickoff_at')
        .range(from, to),
    );

    for (const row of rows) {
      if (row.home_goals === null || row.away_goals === null) continue;
      matches.push({
        fixtureId: row.id,
        leagueId: row.league_id,
        homeTeamId: row.home_team_id,
        awayTeamId: row.away_team_id,
        homeGoals: row.home_goals,
        awayGoals: row.away_goals,
        date: new Date(row.kickoff_at),
      });
    }
  }

  return matches;
}

async function fetchHistoricalOdds(
  supabase: SupabaseClient,
  since: string,
): Promise<Map<string, { early: MarketQuotes; closing: MarketQuotes }>> {
  const rows = await fetchAll<{ fixture_id: string; early: MarketQuotes; closing: MarketQuotes }>(
    (from, to) =>
      supabase
        .from('historical_odds')
        .select('fixture_id, early, closing, fixtures!inner(kickoff_at)')
        .gte('fixtures.kickoff_at', since)
        .order('fixture_id')
        .range(from, to),
  );

  return new Map(
    rows.map((row) => [
      row.fixture_id,
      { early: withCommission(row.early), closing: withCommission(row.closing) },
    ]),
  );
}

/** Las mismas comisiones que aplica generate-parlays: si no, el backtest mediría otra cosa. */
function withCommission(quotes: MarketQuotes): MarketQuotes {
  const tag = (list: MarketQuotes['matchResult']) =>
    list?.map((quote) => ({ ...quote, commission: commissionOf(quote.bookmaker) }));
  return { matchResult: tag(quotes.matchResult), totals25: tag(quotes.totals25) };
}

/** PostgREST corta en 1000 filas; se pagina hasta agotar. */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const size = 1000;
  const all: T[] = [];

  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(`Lectura paginada fallida: ${error.message}`);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < size) break;
  }

  return all;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
