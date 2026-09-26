/**
 * Esquema de una fila de `model_calibrations`, tal como la escribe la Edge
 * Function `backtest`.
 *
 * `metrics` es JSONB libre en Postgres: si el backtest cambia de forma y la app
 * no, la pantalla que explica el modelo tiene que fallar diciéndolo en vez de
 * pintar ceros que parecen resultados.
 */

import { z } from 'zod';

const score = z.object({
  logLoss: z.number(),
  brier: z.number(),
  events: z.number().int(),
});

const comparison = z.object({
  events: z.number().int(),
  model: score,
  market: score,
  blend: score,
});

const simulation = z.object({
  minEdge: z.number(),
  bets: z.number().int(),
  profit: z.number(),
  roi: z.number(),
  standardError: z.number(),
  hitRate: z.number(),
  averageClv: z.number().nullable(),
  clvBeatRate: z.number().nullable(),
});

export const calibrationMetricsSchema = z.object({
  curve: z.array(z.object({ weight: z.number(), logLoss: z.number(), brier: z.number() })).min(2),
  improvementOverMarket: z.number(),
  standardError: z.number(),
  defaultWeight: z.number(),
  byMarket: z.object({
    match_result: comparison,
    total_goals_2_5: comparison,
  }),
  byLeague: z.array(comparison.extend({ leagueId: z.string(), name: z.string() })),
  betting: z.object({
    calibrated: z.array(simulation),
    default: z.array(simulation),
  }),
  skipped: z.record(z.string(), z.number()),
});

export const calibrationSchema = z.object({
  id: z.number(),
  model_weight: z.number().min(0).max(1),
  applied: z.boolean(),
  fixtures: z.number().int(),
  events: z.number().int(),
  window_from: z.string().nullable(),
  window_to: z.string().nullable(),
  created_at: z.string(),
  metrics: calibrationMetricsSchema,
});

export type CalibrationMetrics = z.infer<typeof calibrationMetricsSchema>;
export type Calibration = z.infer<typeof calibrationSchema>;
export type BettingSimulationRow = z.infer<typeof simulation>;
