import { describe, expect, it } from 'vitest';
import { calibrationSchema } from './calibration.js';

const score = { logLoss: 0.83, brier: 0.52, events: 10 };
const comparison = { events: 10, model: score, market: score, blend: score };
const simulation = {
  minEdge: 0.02,
  bets: 3,
  profit: 1.2,
  roi: 0.4,
  standardError: 0.7,
  hitRate: 0.66,
  averageClv: null,
  clvBeatRate: null,
};

const row = {
  id: 1,
  model_weight: 0,
  applied: true,
  fixtures: 1477,
  events: 2954,
  window_from: '2025-09-15T19:00:00+00:00',
  window_to: '2026-09-20T19:00:00+00:00',
  created_at: '2026-09-26T03:30:00+00:00',
  metrics: {
    curve: [
      { weight: 0, logLoss: 0.826, brier: 0.53 },
      { weight: 1, logLoss: 0.852, brier: 0.55 },
    ],
    improvementOverMarket: 0,
    standardError: 0,
    defaultWeight: 0.35,
    byMarket: { match_result: comparison, total_goals_2_5: comparison },
    byLeague: [{ ...comparison, leagueId: 'football-data:PD', name: 'La Liga' }],
    betting: { calibrated: [simulation], default: [simulation] },
    skipped: { 'equipo sin histórico previo': 12 },
  },
};

describe('calibrationSchema', () => {
  it('acepta la fila que escribe el backtest', () => {
    expect(calibrationSchema.safeParse(row).success).toBe(true);
  });

  it('rechaza un peso fuera de [0, 1]', () => {
    expect(calibrationSchema.safeParse({ ...row, model_weight: 1.2 }).success).toBe(false);
  });

  it('rechaza métricas a las que les falta la simulación', () => {
    const { betting: _betting, ...metrics } = row.metrics;
    expect(calibrationSchema.safeParse({ ...row, metrics }).success).toBe(false);
  });
});
