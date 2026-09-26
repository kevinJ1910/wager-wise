import { describe, expect, it } from 'vitest';
import {
  brierScore,
  buildBacktestEvents,
  calibrateModelWeight,
  logLoss,
  simulateBetting,
  type BacktestEvent,
  type BacktestFixture,
  type LeagueMatch,
} from './backtest.js';

/** Generador determinista: los tests no pueden depender de Math.random. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const LEAGUE = 'liga';
const TEAMS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** Una liga de seis equipos con una jornada cada tres días desde el 1 de agosto. */
function seasonHistory(rounds: number): LeagueMatch[] {
  const random = rng(7);
  const matches: LeagueMatch[] = [];
  for (let round = 0; round < rounds; round++) {
    const date = new Date(Date.UTC(2025, 7, 1 + round * 3, 18));
    for (let i = 0; i < TEAMS.length; i += 2) {
      const home = TEAMS[(i + round) % TEAMS.length]!;
      const away = TEAMS[(i + round + 1) % TEAMS.length]!;
      matches.push({
        leagueId: LEAGUE,
        homeTeamId: home,
        awayTeamId: away,
        homeGoals: Math.floor(random() * 4),
        awayGoals: Math.floor(random() * 3),
        date,
      });
    }
  }
  return matches;
}

const QUOTES = {
  matchResult: [
    { bookmaker: 'x', odds: [2.1, 3.4, 3.6] },
    { bookmaker: 'y', odds: [2.05, 3.5, 3.7] },
  ],
  totals25: [{ bookmaker: 'x', odds: [1.9, 1.95] }],
};

function fixture(over: Partial<BacktestFixture>): BacktestFixture {
  return {
    fixtureId: 'f1',
    leagueId: LEAGUE,
    homeTeamId: 'a',
    awayTeamId: 'b',
    homeGoals: 1,
    awayGoals: 1,
    date: new Date(Date.UTC(2025, 9, 20, 20)),
    early: QUOTES,
    closing: QUOTES,
    ...over,
  };
}

describe('buildBacktestEvents', () => {
  it('no deja que la predicción vea resultados del mismo día o posteriores', () => {
    const history = seasonHistory(25);
    const target = fixture({});

    const before = buildBacktestEvents([target], history, { minMatches: 10 });

    // Mismo día y días después: si alguno se colara en el ajuste, la
    // probabilidad del modelo cambiaría.
    const leaked: LeagueMatch[] = [
      { leagueId: LEAGUE, homeTeamId: 'a', awayTeamId: 'b', homeGoals: 9, awayGoals: 0, date: new Date(Date.UTC(2025, 9, 20, 12)) },
      { leagueId: LEAGUE, homeTeamId: 'a', awayTeamId: 'c', homeGoals: 8, awayGoals: 0, date: new Date(Date.UTC(2025, 9, 25)) },
    ];
    const after = buildBacktestEvents([target], [...history, ...leaked], { minMatches: 10 });

    expect(after.events[0]!.modelProbabilities).toEqual(before.events[0]!.modelProbabilities);
  });

  it('no predice sin muestra mínima en la liga', () => {
    const { events, skipped } = buildBacktestEvents([fixture({})], seasonHistory(2), { minMatches: 40 });
    expect(events).toHaveLength(0);
    expect(skipped[0]!.reason).toMatch(/partidos previos/);
  });

  it('omite al recién ascendido sin partidos, como en producción', () => {
    const { events, skipped } = buildBacktestEvents(
      [fixture({ homeTeamId: 'nuevo' })],
      seasonHistory(25),
      { minMatches: 10 },
    );
    expect(events).toHaveLength(0);
    expect(skipped[0]!.reason).toMatch(/sin histórico/);
  });

  it('codifica el resultado: 0-0 es empate y bajo 2.5', () => {
    const { events } = buildBacktestEvents(
      [fixture({ homeGoals: 0, awayGoals: 0 })],
      seasonHistory(25),
      { minMatches: 10 },
    );

    const result = events.find((e) => e.kind === 'match_result')!;
    const totals = events.find((e) => e.kind === 'total_goals_2_5')!;
    expect(result.outcome).toBe(1);
    expect(totals.outcome).toBe(1);
  });

  it('las probabilidades de modelo y mercado suman 1', () => {
    const { events } = buildBacktestEvents([fixture({})], seasonHistory(25), { minMatches: 10 });
    for (const event of events) {
      expect(event.modelProbabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      expect(event.marketProbabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
  });

  it('decide con la mejor cuota previa y guarda la de cierre aparte', () => {
    const { events } = buildBacktestEvents(
      [
        fixture({
          closing: { matchResult: [{ bookmaker: 'x', odds: [1.9, 3.6, 4.2] }] },
        }),
      ],
      seasonHistory(25),
      { minMatches: 10 },
    );

    const result = events.find((e) => e.kind === 'match_result')!;
    expect(result.offeredOdds).toEqual([2.1, 3.5, 3.7]);
    expect(result.closingOdds).toEqual([1.9, 3.6, 4.2]);

    const totals = events.find((e) => e.kind === 'total_goals_2_5')!;
    expect(totals.closingOdds).toBeNull();
  });

  it('descarta casas con cuotas imposibles en vez de promediarlas', () => {
    const { events } = buildBacktestEvents(
      [
        fixture({
          early: {
            matchResult: [
              { bookmaker: 'x', odds: [2.1, 3.4, 3.6] },
              { bookmaker: 'rota', odds: [0, Number.NaN, 3] },
            ],
          },
        }),
      ],
      seasonHistory(25),
      { minMatches: 10 },
    );

    expect(events[0]!.offeredOdds).toEqual([2.1, 3.4, 3.6]);
  });
});

describe('reglas de puntuación', () => {
  it('log loss castiga más la sobreconfianza que la prudencia', () => {
    expect(logLoss([0.02, 0.98], 0)).toBeGreaterThan(logLoss([0.3, 0.7], 0));
    expect(logLoss([1, 0], 0)).toBeCloseTo(0, 12);
  });

  it('log loss no revienta con probabilidad cero', () => {
    expect(Number.isFinite(logLoss([0, 1], 0))).toBe(true);
  });

  it('Brier multiclase', () => {
    // (0.5−1)² + 0.3² + 0.2²
    expect(brierScore([0.5, 0.3, 0.2], 0)).toBeCloseTo(0.38, 12);
  });
});

/**
 * Eventos sintéticos donde el resultado sale de una distribución conocida.
 * Si la verdad es el modelo, la calibración debe irse a w alto; si es el
 * mercado, a w bajo. Es la prueba de que optimiza lo que dice optimizar.
 */
function syntheticEvents(truth: 'model' | 'market', n: number): BacktestEvent[] {
  const random = rng(truth === 'model' ? 11 : 13);
  const events: BacktestEvent[] = [];

  for (let i = 0; i < n; i++) {
    const a = 0.2 + random() * 0.6;
    const b = 0.2 + random() * 0.6;
    const model = [a, 1 - a];
    const market = [b, 1 - b];
    const source = truth === 'model' ? model : market;

    events.push({
      fixtureId: `s${i}`,
      leagueId: LEAGUE,
      kickoff: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString(),
      kind: 'total_goals_2_5',
      outcome: random() < source[0]! ? 0 : 1,
      modelProbabilities: model,
      marketProbabilities: market,
      offeredOdds: market.map((p) => 0.97 / p),
      closingOdds: null,
    });
  }

  return events;
}

describe('calibrateModelWeight', () => {
  it('se va al mercado cuando el mercado es la verdad', () => {
    const calibration = calibrateModelWeight(syntheticEvents('market', 4000));
    expect(calibration.weight).toBeLessThanOrEqual(0.1);
  });

  it('se va al modelo cuando el modelo es la verdad', () => {
    const calibration = calibrateModelWeight(syntheticEvents('model', 4000));
    expect(calibration.weight).toBeGreaterThanOrEqual(0.9);
    // Y la mejora sobre el mercado es real, no ruido.
    expect(calibration.improvementOverMarket).toBeGreaterThan(2 * calibration.standardError);
  });

  it('la curva recorre la rejilla completa y el elegido es su mínimo', () => {
    const calibration = calibrateModelWeight(syntheticEvents('model', 500), 0.1);
    expect(calibration.curve.map((point) => point.weight)).toHaveLength(11);
    const minimum = Math.min(...calibration.curve.map((point) => point.logLoss));
    expect(calibration.curve.find((p) => p.weight === calibration.weight)!.logLoss).toBe(minimum);
  });

  it('sin eventos no inventa un peso', () => {
    expect(() => calibrateModelWeight([])).toThrow(RangeError);
  });
});

describe('simulateBetting', () => {
  const event = (over: Partial<BacktestEvent>): BacktestEvent => ({
    fixtureId: 'e',
    leagueId: LEAGUE,
    kickoff: '2025-10-01T00:00:00Z',
    kind: 'total_goals_2_5',
    outcome: 0,
    modelProbabilities: [0.6, 0.4],
    marketProbabilities: [0.5, 0.5],
    offeredOdds: [2.1, 1.8],
    closingOdds: [1.9, 1.95],
    ...over,
  });

  it('apuesta sólo lo que supera el umbral de ventaja', () => {
    // Con w = 1 la ventaja del "más" es 0.6 − 1/2.1 ≈ 0.124; la del "menos", negativa.
    const simulation = simulateBetting([event({})], 1, 0.02);
    expect(simulation.bets).toBe(1);
    expect(simulation.profit).toBeCloseTo(1.1, 12);
  });

  it('con w = 0 y un mercado sin margen no hay nada que apostar', () => {
    const simulation = simulateBetting([event({ offeredOdds: [2, 2] })], 0, 0.02);
    expect(simulation.bets).toBe(0);
    expect(simulation.roi).toBe(0);
    expect(simulation.averageClv).toBeNull();
  });

  it('mide el CLV contra el cierre de la misma selección', () => {
    const simulation = simulateBetting([event({})], 1, 0.02);
    // 2.1 / 1.9 − 1
    expect(simulation.averageClv).toBeCloseTo(2.1 / 1.9 - 1, 12);
    expect(simulation.clvBeatRate).toBe(1);
  });

  it('una apuesta perdida resta la unidad entera', () => {
    const simulation = simulateBetting([event({ outcome: 1 })], 1, 0.02);
    expect(simulation.profit).toBe(-1);
    expect(simulation.hitRate).toBe(0);
  });
});
