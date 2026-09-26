/**
 * Backtesting: reproducir el motor sobre partidos ya jugados y medir si acierta.
 *
 * Tres preguntas, en orden de honestidad:
 *
 *   1. **¿Las probabilidades son buenas?** Log loss y Brier contra el resultado
 *      real. Es la pregunta que decide `w`, porque no depende de la suerte de
 *      unas pocas apuestas: cada partido aporta información, se apueste o no.
 *   2. **¿Se habría batido la línea de cierre?** CLV de las selecciones que el
 *      motor habría propuesto. Predice beneficio con muchas menos muestras que
 *      el propio beneficio.
 *   3. **¿Se habría ganado dinero?** ROI con su error estándar. Es lo que todo
 *      el mundo mira primero y lo que menos dice con pocos cientos de apuestas.
 *
 * La regla que no se negocia: **ninguna predicción ve datos posteriores a su
 * partido**. El modelo se reajusta para cada jornada sólo con los partidos
 * jugados antes de ella; las cuotas son las publicadas días antes del saque, y
 * el cierre se usa únicamente para medir, nunca para decidir.
 */

import { consensusProbabilities, type BookQuote } from './consensus.js';
import {
  fitDixonColes,
  scoreMatrix,
  type FitOptions,
  type HistoricalMatch,
} from './dixon-coles.js';
import { matchResultProbabilities, selectionProbability } from './markets.js';
import { closingLineValue } from './tracking.js';
import { blendProbabilities, edge } from './value.js';

const MS_PER_DAY = 86_400_000;

export interface MarketQuotes {
  /** 1X2 por casa, en orden local / empate / visitante. */
  matchResult?: BookQuote[];
  /** Más / menos de 2.5 goles por casa, en ese orden. */
  totals25?: BookQuote[];
}

export interface LeagueMatch extends HistoricalMatch {
  leagueId: string;
}

export interface BacktestFixture extends LeagueMatch {
  fixtureId: string;
  /** Cuotas publicadas antes del partido: con ellas se decide. */
  early: MarketQuotes;
  /** Cuotas de cierre: sólo para medir el CLV. */
  closing: MarketQuotes;
}

export type BacktestMarket = 'match_result' | 'total_goals_2_5';

/** Un mercado de un partido ya jugado, con todo lo necesario para puntuarlo. */
export interface BacktestEvent {
  fixtureId: string;
  leagueId: string;
  kickoff: string;
  kind: BacktestMarket;
  /** Índice del resultado que ocurrió. */
  outcome: number;
  modelProbabilities: number[];
  marketProbabilities: number[];
  /** Mejor cuota previa por resultado: la que el usuario habría cogido. */
  offeredOdds: number[];
  /** Mejor cuota de cierre por resultado, si la hay. */
  closingOdds: number[] | null;
}

export interface BacktestOptions {
  /** Partidos previos de la liga por debajo de los cuales no se predice. */
  minMatches?: number;
  fit?: Omit<FitOptions, 'asOf'>;
}

export interface SkippedFixture {
  fixtureId: string;
  reason: string;
}

/**
 * Convierte partidos jugados en eventos puntuables, en walk-forward.
 *
 * El modelo se reajusta una vez por liga y día, con los partidos anteriores a
 * ese día. Reajustar por partido daría lo mismo —dos partidos del mismo día no
 * se informan entre sí— a un coste mucho mayor.
 */
export function buildBacktestEvents(
  fixtures: readonly BacktestFixture[],
  history: readonly LeagueMatch[],
  options: BacktestOptions = {},
): { events: BacktestEvent[]; skipped: SkippedFixture[] } {
  const { minMatches = 40, fit = {} } = options;

  const historyByLeague = new Map<string, LeagueMatch[]>();
  for (const match of history) {
    const bucket = historyByLeague.get(match.leagueId) ?? [];
    bucket.push(match);
    historyByLeague.set(match.leagueId, bucket);
  }
  for (const bucket of historyByLeague.values()) {
    bucket.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  // Agrupados por liga y día, para ajustar una sola vez por grupo.
  const groups = new Map<string, BacktestFixture[]>();
  for (const fixture of fixtures) {
    const key = `${fixture.leagueId}|${startOfDay(fixture.date).toISOString()}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(fixture);
    groups.set(key, bucket);
  }

  const events: BacktestEvent[] = [];
  const skipped: SkippedFixture[] = [];

  for (const [key, group] of groups) {
    const [leagueId, day] = key.split('|') as [string, string];
    const cutoff = new Date(day);

    // Estrictamente antes del día: un partido de la tarde no puede aprender
    // del resultado de uno de la mañana que el usuario no conocía al apostar.
    const past = (historyByLeague.get(leagueId) ?? []).filter(
      (match) => match.date.getTime() < cutoff.getTime(),
    );

    if (past.length < minMatches) {
      for (const fixture of group) {
        skipped.push({
          fixtureId: fixture.fixtureId,
          reason: `sólo ${past.length} partidos previos en la liga`,
        });
      }
      continue;
    }

    const model = fitDixonColes(past, { ...fit, asOf: cutoff });

    for (const fixture of group) {
      if (!model.ratings.has(fixture.homeTeamId) || !model.ratings.has(fixture.awayTeamId)) {
        // Igual que en producción: un recién ascendido sin partidos no tiene
        // predicción honesta posible.
        skipped.push({ fixtureId: fixture.fixtureId, reason: 'equipo sin histórico previo' });
        continue;
      }

      const matrix = scoreMatrix(model, fixture.homeTeamId, fixture.awayTeamId, 10);
      const base = {
        fixtureId: fixture.fixtureId,
        leagueId,
        kickoff: fixture.date.toISOString(),
      };

      const result = matchResultProbabilities(matrix);
      const matchResult = marketEvent(
        [result.home, result.draw, result.away],
        fixture.early.matchResult,
        fixture.closing.matchResult,
      );
      if (matchResult) {
        events.push({
          ...base,
          kind: 'match_result',
          outcome: fixture.homeGoals > fixture.awayGoals ? 0 : fixture.homeGoals === fixture.awayGoals ? 1 : 2,
          ...matchResult,
        });
      }

      const over = selectionProbability(matrix, { kind: 'total_goals', line: 2.5, side: 'over' });
      const totals = marketEvent([over, 1 - over], fixture.early.totals25, fixture.closing.totals25);
      if (totals) {
        events.push({
          ...base,
          kind: 'total_goals_2_5',
          outcome: fixture.homeGoals + fixture.awayGoals > 2.5 ? 0 : 1,
          ...totals,
        });
      }

      if (!matchResult && !totals) {
        skipped.push({ fixtureId: fixture.fixtureId, reason: 'sin cuotas previas utilizables' });
      }
    }
  }

  events.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  return { events, skipped };
}

function marketEvent(
  modelProbabilities: number[],
  early: readonly BookQuote[] | undefined,
  closing: readonly BookQuote[] | undefined,
): Pick<BacktestEvent, 'modelProbabilities' | 'marketProbabilities' | 'offeredOdds' | 'closingOdds'> | null {
  const earlyQuotes = usableQuotes(early, modelProbabilities.length);
  if (earlyQuotes.length === 0) return null;

  const consensus = consensusProbabilities(earlyQuotes);
  const closingQuotes = usableQuotes(closing, modelProbabilities.length);

  return {
    modelProbabilities,
    marketProbabilities: consensus.probabilities,
    offeredOdds: consensus.bestOdds.map((best) => best.odds),
    closingOdds:
      closingQuotes.length > 0
        ? consensusProbabilities(closingQuotes).bestOdds.map((best) => best.odds)
        : null,
  };
}

/** Descarta casas con precios incompletos o imposibles antes de promediarlas. */
function usableQuotes(quotes: readonly BookQuote[] | undefined, outcomes: number): BookQuote[] {
  return (quotes ?? []).filter(
    (quote) =>
      quote.odds.length === outcomes && quote.odds.every((odds) => Number.isFinite(odds) && odds > 1),
  );
}

function startOfDay(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MS_PER_DAY) * MS_PER_DAY);
}

// ─────────────────────────────────────────────────────────────
// Puntuación de probabilidades
// ─────────────────────────────────────────────────────────────

/**
 * Pérdida logarítmica del resultado ocurrido. Es la regla propia que castiga
 * sin piedad la sobreconfianza: dar un 2% a lo que pasó cuesta mucho más que
 * dar un 30%.
 */
export function logLoss(probabilities: readonly number[], outcome: number): number {
  return -Math.log(Math.max(probabilities[outcome] ?? 0, 1e-12));
}

/** Brier multiclase: suma de errores cuadráticos contra el resultado. */
export function brierScore(probabilities: readonly number[], outcome: number): number {
  return probabilities.reduce((sum, p, index) => sum + (p - (index === outcome ? 1 : 0)) ** 2, 0);
}

export function blendEvent(event: BacktestEvent, weight: number): number[] {
  return event.modelProbabilities.map((model, index) =>
    blendProbabilities(model, event.marketProbabilities[index]!, weight),
  );
}

export interface WeightScore {
  weight: number;
  logLoss: number;
  brier: number;
}

export interface WeightCalibration {
  /** Peso del modelo que minimiza la log loss sobre el histórico. */
  weight: number;
  events: number;
  curve: WeightScore[];
  /**
   * Mejora media de log loss del peso elegido frente al mercado solo, con su
   * error estándar. Si la mejora no supera un par de errores estándar, el
   * modelo no está aportando nada que el mercado no supiera.
   */
  improvementOverMarket: number;
  standardError: number;
}

/**
 * Calibra `w` por máxima verosimilitud sobre una rejilla.
 *
 * Se optimiza la log loss y no el ROI a propósito: el ROI de unos cientos de
 * apuestas es casi todo varianza y elegir `w` por él sería ajustar el ruido.
 * La log loss usa todos los partidos, se apueste o no.
 */
export function calibrateModelWeight(
  events: readonly BacktestEvent[],
  step = 0.05,
): WeightCalibration {
  if (events.length === 0) {
    throw new RangeError('No hay eventos con los que calibrar.');
  }

  const curve: WeightScore[] = [];
  const steps = Math.round(1 / step);

  for (let i = 0; i <= steps; i++) {
    const weight = Math.min(1, i * step);
    let totalLogLoss = 0;
    let totalBrier = 0;

    for (const event of events) {
      const blended = blendEvent(event, weight);
      totalLogLoss += logLoss(blended, event.outcome);
      totalBrier += brierScore(blended, event.outcome);
    }

    curve.push({
      weight,
      logLoss: totalLogLoss / events.length,
      brier: totalBrier / events.length,
    });
  }

  const best = curve.reduce((a, b) => (b.logLoss < a.logLoss ? b : a));

  // Diferencias pareadas: cada evento contra sí mismo con w = 0, que es lo que
  // quita la varianza entre partidos y deja sólo la del modelo.
  const differences = events.map(
    (event) =>
      logLoss(event.marketProbabilities, event.outcome) -
      logLoss(blendEvent(event, best.weight), event.outcome),
  );

  const { mean, standardError } = meanAndError(differences);

  return {
    weight: best.weight,
    events: events.length,
    curve,
    improvementOverMarket: mean,
    standardError,
  };
}

// ─────────────────────────────────────────────────────────────
// Simulación de apuestas
// ─────────────────────────────────────────────────────────────

export interface BettingSimulation {
  minEdge: number;
  bets: number;
  /** En unidades de stake plano. */
  profit: number;
  roi: number;
  /** Error estándar del ROI. Un ROI a menos de dos errores de cero es ruido. */
  standardError: number;
  hitRate: number;
  averageClv: number | null;
  clvBeatRate: number | null;
}

/**
 * Stake plano de una unidad en cada selección que habría pasado el filtro de
 * ventaja, a la mejor cuota previa.
 *
 * Plano y no Kelly: con Kelly el resultado depende del orden de las apuestas y
 * del bankroll de partida, y aquí sólo interesa si la señal vale algo.
 */
export function simulateBetting(
  events: readonly BacktestEvent[],
  weight: number,
  minEdge: number,
): BettingSimulation {
  const returns: number[] = [];
  const clvs: number[] = [];
  let wins = 0;

  for (const event of events) {
    const blended = blendEvent(event, weight);

    blended.forEach((probability, index) => {
      const odds = event.offeredOdds[index]!;
      if (edge(probability, odds) < minEdge) return;

      const won = index === event.outcome;
      returns.push(won ? odds - 1 : -1);
      if (won) wins += 1;

      const closing = event.closingOdds?.[index];
      if (closing !== undefined && closing > 1) clvs.push(closingLineValue(odds, closing));
    });
  }

  const { mean, standardError } = meanAndError(returns);
  const profit = returns.reduce((a, b) => a + b, 0);

  return {
    minEdge,
    bets: returns.length,
    profit,
    roi: returns.length > 0 ? mean : 0,
    standardError,
    hitRate: returns.length > 0 ? wins / returns.length : 0,
    averageClv: clvs.length > 0 ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null,
    clvBeatRate: clvs.length > 0 ? clvs.filter((clv) => clv > 0).length / clvs.length : null,
  };
}

/** Puntuación de unas probabilidades fijas —modelo, mercado o mezcla— por mercado. */
export function scoreEvents(
  events: readonly BacktestEvent[],
  weight: number,
): { logLoss: number; brier: number; events: number } {
  if (events.length === 0) return { logLoss: 0, brier: 0, events: 0 };

  let totalLogLoss = 0;
  let totalBrier = 0;
  for (const event of events) {
    const blended = blendEvent(event, weight);
    totalLogLoss += logLoss(blended, event.outcome);
    totalBrier += brierScore(blended, event.outcome);
  }

  return {
    logLoss: totalLogLoss / events.length,
    brier: totalBrier / events.length,
    events: events.length,
  };
}

function meanAndError(values: readonly number[]): { mean: number; standardError: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, standardError: 0 };

  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, standardError: 0 };

  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  return { mean, standardError: Math.sqrt(variance / n) };
}
