/**
 * Genera las predicciones del día y los tres parlays recomendados.
 *
 * Es donde se juntan las dos mitades: el modelo ajustado (fit-model) y las
 * cuotas ingeridas (ingest-odds). Todo el cálculo es del motor; Gemini sólo
 * añade la explicación al final, y si falla las recomendaciones quedan igual.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  blendProbabilities,
  consensusProbabilities,
  describeSelection,
  edge as computeEdge,
  evaluateParlay,
  expectedValue,
  auditParlay,
  RISK_PROFILES,
  scoreMatrixFromRates,
  selectionProbability,
  type ParlayLeg,
  type Selection,
} from '../../../packages/engine/dist/index.js';
import { analyzeParlay, type LegBrief } from '../_shared/gemini.ts';
import { trackRun } from '../_shared/quota.ts';

/**
 * Peso del modelo frente al consenso mientras no haya calibración aplicable.
 * El valor real sale de la última fila de `model_calibrations` que el backtest
 * semanal marcó como aplicable (ver `backtest`).
 */
const DEFAULT_MODEL_WEIGHT = 0.35;

/** Ventaja mínima para considerar una selección. */
const MIN_EDGE = 0.02;

/**
 * Hasta dónde se calculan selecciones con valor.
 *
 * Lo marca el horizonte de las casas, no el del calendario: sin cuota no hay
 * ventaja que medir. Cubrirlo entero es lo que mantiene la pantalla de Valor
 * con contenido toda la semana y no sólo la víspera de cada jornada.
 */
const CANDIDATE_HORIZON_HOURS = 8 * 24;

/**
 * Hasta dónde llega el "parlay del día".
 *
 * Más corto que las selecciones a propósito: un parlay diario que combinara
 * partidos de dentro de una semana dejaría de ser del día, y las cuotas de esa
 * jornada todavía se mueven mucho.
 */
const PARLAY_HORIZON_HOURS = 72;

const TIERS = [
  { tier: 'safe' as const, minOdds: 1.5, maxOdds: 2.5, maxLegs: 2 },
  { tier: 'balanced' as const, minOdds: 2.5, maxOdds: 6, maxLegs: 3 },
  { tier: 'aggressive' as const, minOdds: 6, maxOdds: 25, maxLegs: 4 },
];

/** Fila de partido tal como la pide `buildCandidates`. */
interface FixtureRow {
  id: string;
  league_id: string;
  kickoff_at: string;
  home_team_id: string;
  away_team_id: string;
  home: { name: string } | null;
  away: { name: string } | null;
  leagues: { name: string } | null;
}

interface Candidate {
  fixtureId: string;
  matchLabel: string;
  league: string;
  kickoff: string;
  selection: Selection;
  odds: number;
  bookmakerId: string | null;
  modelProbability: number;
  marketProbability: number;
  blendedProbability: number;
  edge: number;
  expectedValue: number;
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const finishRun = await trackRun(supabase, 'generate-parlays');
  const summary = {
    modelWeight: DEFAULT_MODEL_WEIGHT,
    candidates: 0,
    predictions: 0,
    parlays: 0,
    analyses: 0,
    notes: [] as string[],
  };

  try {
    summary.modelWeight = await currentModelWeight(supabase);
    const { candidates, matrices } = await buildCandidates(supabase, summary.modelWeight, summary);
    summary.candidates = candidates.length;

    if (candidates.length === 0) {
      summary.notes.push('Sin candidatos: faltan cuotas o el modelo no está ajustado.');
      await finishRun('ok', summary);
      return json(summary);
    }

    summary.predictions = await storePredictions(supabase, candidates);

    const today = new Date().toISOString().slice(0, 10);
    // Regenerar el día es idempotente: borramos lo anterior antes de escribir.
    await supabase.from('parlay_recommendations').delete().eq('for_date', today);

    // Las selecciones sueltas llegan hasta el horizonte de las casas, pero el
    // parlay del día sólo combina partidos cercanos.
    const deadline = Date.now() + PARLAY_HORIZON_HOURS * 3_600_000;
    const soon = candidates.filter((c) => new Date(c.kickoff).getTime() <= deadline);

    for (const spec of TIERS) {
      const legs = pickLegs(soon, spec, matrices);
      if (legs.length < 2) {
        summary.notes.push(`${spec.tier}: sin combinación válida en el rango de cuota.`);
        continue;
      }

      const evaluation = evaluateParlay(legs, matrices);
      const parlayId = await storeParlay(supabase, today, spec.tier, legs, evaluation);
      summary.parlays += 1;

      const analyzed = await attachAnalysis(supabase, parlayId, legs, evaluation, candidates);
      summary.analyses += analyzed;
    }

    await finishRun('ok', summary);
    return json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun('failed', { message, summary });
    return json({ error: message, summary }, 500);
  }
});

/**
 * Construye las selecciones con valor a partir del modelo y las cuotas más
 * recientes de cada partido.
 */
async function buildCandidates(
  supabase: SupabaseClient,
  modelWeight: number,
  summary: { notes: string[] },
): Promise<{ candidates: Candidate[]; matrices: Map<string, number[][]> }> {
  const now = new Date();
  const horizon = new Date(now.getTime() + CANDIDATE_HORIZON_HOURS * 3_600_000);

  const { data: fixtures, error } = await supabase
    .from('fixtures')
    .select(
      'id, league_id, kickoff_at, home_team_id, away_team_id, ' +
        'home:teams!fixtures_home_team_id_fkey(name), away:teams!fixtures_away_team_id_fkey(name), ' +
        'leagues(name)',
    )
    .eq('status', 'scheduled')
    .gte('kickoff_at', now.toISOString())
    .lte('kickoff_at', horizon.toISOString())
    .order('kickoff_at');

  if (error) throw new Error(`No se pudieron leer partidos: ${error.message}`);

  // El tipado de un select con relaciones embebidas devuelve una unión que
  // incluye el tipo de error de PostgREST. Como el error ya se comprobó arriba,
  // estrechamos aquí a la forma que realmente pedimos.
  const rows = (fixtures ?? []) as unknown as FixtureRow[];

  const candidates: Candidate[] = [];
  const matrices = new Map<string, number[][]>();

  for (const fixture of rows) {
    const fixtureId = fixture.id;
    const leagueId = fixture.league_id;

    const matrix = await buildMatrix(supabase, leagueId, fixture);
    if (!matrix) {
      summary.notes.push(`${fixtureId}: sin modelo ajustado para su liga.`);
      continue;
    }
    matrices.set(fixtureId, matrix);

    const { data: snapshots } = await supabase
      .from('odds_snapshots')
      .select('bookmaker_id, market_kind, market_params, outcomes, captured_at')
      .eq('fixture_id', fixtureId)
      .order('captured_at', { ascending: false })
      .limit(120);

    if (!snapshots || snapshots.length === 0) continue;

    const matchLabel = `${nameOf(fixture, 'home')} vs ${nameOf(fixture, 'away')}`;
    const league = fixture.leagues?.name ?? leagueId;

    candidates.push(
      ...evaluateFixture(matrix, snapshots, modelWeight, {
        fixtureId,
        matchLabel,
        league,
        kickoff: fixture.kickoff_at,
      }),
    );
  }

  return { candidates, matrices };
}

/**
 * El `w` de la última calibración aplicable, o el valor por defecto.
 *
 * Un fallo de lectura no para la generación: el valor por defecto es con lo que
 * la app funcionó hasta tener backtesting, peor pero no roto.
 */
async function currentModelWeight(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from('model_calibrations')
    .select('model_weight')
    .eq('applied', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return DEFAULT_MODEL_WEIGHT;
  const weight = Number(data.model_weight);
  return Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : DEFAULT_MODEL_WEIGHT;
}

/** Matriz de marcadores del partido a partir del ajuste guardado. */
async function buildMatrix(
  supabase: SupabaseClient,
  leagueId: string,
  fixture: FixtureRow,
): Promise<number[][] | null> {
  const { data: fit } = await supabase
    .from('model_fits')
    .select('home_advantage, rho, base_rate')
    .eq('league_id', leagueId)
    .maybeSingle();

  if (!fit) return null;

  const { data: ratings } = await supabase
    .from('team_ratings')
    .select('team_id, attack, defence')
    .eq('league_id', leagueId)
    .in('team_id', [fixture.home_team_id, fixture.away_team_id]);

  const home = ratings?.find((r) => r.team_id === fixture.home_team_id);
  const away = ratings?.find((r) => r.team_id === fixture.away_team_id);
  // Un equipo recién ascendido puede no tener rating todavía. Sin él no hay
  // predicción honesta posible, así que se omite el partido.
  if (!home || !away) return null;

  const base = fit.base_rate as number;
  const adv = fit.home_advantage as number;
  const lambda = base * (home.attack as number) * (away.defence as number) * adv;
  const mu = (base * (away.attack as number) * (home.defence as number)) / adv;

  return scoreMatrixFromRates(lambda, mu, fit.rho as number, 12);
}

/** Consenso por mercado y comparación contra el modelo. */
function evaluateFixture(
  matrix: number[][],
  snapshots: Record<string, unknown>[],
  modelWeight: number,
  context: { fixtureId: string; matchLabel: string; league: string; kickoff: string },
): Candidate[] {
  // Agrupamos por mercado y nos quedamos con el snapshot más reciente de cada
  // casa: mezclar capturas de distintas horas produciría un consenso falso.
  const byMarket = new Map<string, Map<string, Record<string, unknown>>>();

  for (const snapshot of snapshots) {
    const key = `${snapshot.market_kind}:${JSON.stringify(snapshot.market_params)}`;
    const books = byMarket.get(key) ?? new Map();
    const bookId = snapshot.bookmaker_id as string;
    if (!books.has(bookId)) books.set(bookId, snapshot);
    byMarket.set(key, books);
  }

  const candidates: Candidate[] = [];

  for (const books of byMarket.values()) {
    const quotes: { bookmaker: string; odds: number[] }[] = [];
    let selections: Selection[] | null = null;

    for (const [bookmaker, snapshot] of books) {
      const outcomes = snapshot.outcomes as { selection: Selection; odds: number }[];
      if (!Array.isArray(outcomes) || outcomes.length < 2) continue;

      const theseSelections = outcomes.map((o) => o.selection);
      if (!selections) selections = theseSelections;
      // Si una casa lista los resultados en otro orden, el consenso mezclaría
      // peras con manzanas. Es más seguro descartarla.
      else if (theseSelections.length !== selections.length) continue;

      quotes.push({ bookmaker, odds: outcomes.map((o) => o.odds) });
    }

    if (!selections || quotes.length === 0) continue;

    const consensus = consensusProbabilities(quotes);

    selections.forEach((selection, index) => {
      const marketProbability = consensus.probabilities[index];
      const best = consensus.bestOdds[index];
      if (marketProbability === undefined || !best) return;

      const modelProbability = selectionProbability(matrix, selection);
      const blended = blendProbabilities(modelProbability, marketProbability, modelWeight);
      const edge = computeEdge(blended, best.odds);

      if (edge < MIN_EDGE) return;

      candidates.push({
        ...context,
        selection,
        odds: best.odds,
        bookmakerId: best.bookmaker,
        modelProbability,
        marketProbability,
        blendedProbability: blended,
        edge,
        expectedValue: expectedValue(blended, best.odds),
      });
    });
  }

  return candidates;
}

async function storePredictions(
  supabase: SupabaseClient,
  candidates: Candidate[],
): Promise<number> {
  const rows = candidates.map((c) => ({
    fixture_id: c.fixtureId,
    selection: c.selection,
    model_probability: c.modelProbability,
    market_probability: c.marketProbability,
    blended_probability: c.blendedProbability,
    best_odds: c.odds,
    best_bookmaker_id: c.bookmakerId,
    edge: c.edge,
    expected_value: c.expectedValue,
  }));

  if (rows.length === 0) return 0;

  // Cada pasada sustituye a la anterior para esos partidos, igual que las
  // recomendaciones del día. Acumular una fila por ejecución dejaría varias
  // versiones de la misma selección conviviendo, y cualquiera que leyera la
  // tabla tendría que adivinar cuál es la vigente.
  const fixtureIds = [...new Set(candidates.map((c) => c.fixtureId))];
  const { error: clearError } = await supabase
    .from('model_predictions')
    .delete()
    .in('fixture_id', fixtureIds);
  if (clearError) {
    throw new Error(`No se pudieron limpiar predicciones previas: ${clearError.message}`);
  }

  const { error } = await supabase.from('model_predictions').insert(rows);
  if (error) throw new Error(`No se pudieron guardar predicciones: ${error.message}`);
  return rows.length;
}

/**
 * Elige las legs de un nivel.
 *
 * Una leg por partido: así la multiplicación de cuotas es válida y el parlay no
 * arrastra correlación oculta. El auditor lo comprobaría igualmente, pero es
 * mejor no proponer lo que luego habría que corregir.
 */
function pickLegs(
  candidates: Candidate[],
  spec: (typeof TIERS)[number],
  matrices: Map<string, number[][]>,
): ParlayLeg[] {
  const byEv = [...candidates].sort((a, b) => b.expectedValue - a.expectedValue);

  const used = new Set<string>();
  const legs: ParlayLeg[] = [];
  let combined = 1;

  for (const candidate of byEv) {
    if (legs.length >= spec.maxLegs) break;
    if (used.has(candidate.fixtureId)) continue;
    if (!matrices.has(candidate.fixtureId)) continue;
    if (combined * candidate.odds > spec.maxOdds) continue;

    used.add(candidate.fixtureId);
    combined *= candidate.odds;
    legs.push(toLeg(candidate));
  }

  // Si la cuota se quedó corta para el nivel, el parlay no representa lo que
  // promete. Mejor no publicarlo que publicar uno que no encaja.
  return combined >= spec.minOdds ? legs : [];
}

function toLeg(candidate: Candidate): ParlayLeg {
  return {
    id: `${candidate.fixtureId}:${JSON.stringify(candidate.selection)}`,
    fixtureId: candidate.fixtureId,
    selection: candidate.selection,
    odds: candidate.odds,
    probability: candidate.blendedProbability,
    label: describeSelection(candidate.selection),
    matchLabel: candidate.matchLabel,
  };
}

async function storeParlay(
  supabase: SupabaseClient,
  forDate: string,
  tier: (typeof TIERS)[number]['tier'],
  legs: ParlayLeg[],
  evaluation: ReturnType<typeof evaluateParlay>,
): Promise<string> {
  const { data, error } = await supabase
    .from('parlay_recommendations')
    .insert({
      tier,
      for_date: forDate,
      combined_odds: evaluation.combinedOdds,
      true_probability: evaluation.trueProbability,
      naive_probability: evaluation.naiveProbability,
      expected_value: evaluation.expectedValue,
      any_push_probability: evaluation.anyPushProbability,
    })
    .select('id')
    .single();

  if (error) throw new Error(`No se pudo guardar el parlay ${tier}: ${error.message}`);

  // El tipado genérico del cliente no sabe qué columnas pedimos, así que hay
  // que estrecharlo aquí en vez de confiar en la inferencia.
  const parlayId = (data as unknown as { id: string }).id;

  const { error: legsError } = await supabase.from('parlay_legs').insert(
    legs.map((leg, position) => ({
      parlay_id: parlayId,
      fixture_id: leg.fixtureId,
      selection: leg.selection,
      odds: leg.odds,
      probability: leg.probability,
      position,
    })),
  );
  if (legsError) throw new Error(`No se pudieron guardar las legs: ${legsError.message}`);

  return parlayId;
}

/**
 * Pide a Gemini la explicación de cada leg.
 *
 * Deliberadamente al final y con captura amplia: si la IA falla, el parlay ya
 * está guardado y la app funciona sin el texto.
 */
async function attachAnalysis(
  supabase: SupabaseClient,
  parlayId: string,
  legs: ParlayLeg[],
  evaluation: ReturnType<typeof evaluateParlay>,
  candidates: Candidate[],
): Promise<number> {
  const enabled = (Deno.env.get('GEMINI_ENABLED') ?? 'true') === 'true';
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash';

  if (!enabled || !apiKey) return 0;

  const audit = auditParlay({
    legs,
    evaluation,
    profile: RISK_PROFILES.balanced,
    bankroll: 1_000_000,
    stakeAmount: 40_000,
  });

  const briefs: LegBrief[] = legs.map((leg) => {
    const candidate = candidates.find(
      (c) => c.fixtureId === leg.fixtureId && describeSelection(c.selection) === leg.label,
    );
    return {
      legId: leg.id,
      match: leg.matchLabel ?? '',
      league: candidate?.league ?? '',
      kickoff: candidate?.kickoff ?? '',
      market: leg.label ?? describeSelection(leg.selection),
      odds: leg.odds,
      modelProbabilityPct: `${(leg.probability * 100).toFixed(1)}%`,
      edgePct: `${((candidate?.edge ?? 0) * 100).toFixed(1)}%`,
      expectedValuePct: `${((candidate?.expectedValue ?? 0) * 100).toFixed(1)}%`,
    };
  });

  try {
    const analysis = await analyzeParlay(
      {
        legs: briefs,
        combinedOdds: evaluation.combinedOdds.toFixed(2),
        trueProbabilityPct: `${(evaluation.trueProbability * 100).toFixed(1)}%`,
        expectedValuePct: `${(evaluation.expectedValue * 100).toFixed(1)}%`,
        auditNotes: audit.checks
          .filter((c) => c.severity !== 'ok')
          .map((c) => `${c.title}: ${c.body}`),
      },
      { apiKey, model },
    );

    const rows = analysis.selections.map((selection) => {
      const leg = legs.find((l) => l.id === selection.legId);
      return {
        fixture_id: leg?.fixtureId ?? null,
        selection: leg?.selection ?? null,
        reasoning: selection.reasoning,
        facts: selection.facts,
        confidence: selection.contextConfidence,
        veto: selection.veto,
        veto_reason: selection.vetoReason,
        model,
      };
    });

    const { error } = await supabase.from('ai_analyses').insert(rows);
    if (error) throw new Error(error.message);

    return rows.length;
  } catch (error) {
    console.error(`Análisis de IA fallido para el parlay ${parlayId}:`, error);
    return 0;
  }
}

function nameOf(fixture: FixtureRow, side: 'home' | 'away'): string {
  return fixture[side]?.name ?? '';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
