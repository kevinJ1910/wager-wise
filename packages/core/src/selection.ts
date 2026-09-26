/**
 * Esquema zod de una selección apostable.
 *
 * Las selecciones viajan como JSONB en Postgres y como JSON desde la IA, así
 * que cruzan fronteras sin tipar. Este esquema es el guardián: si algo no
 * valida, no entra.
 *
 * Debe mantenerse alineado con el tipo `Selection` de `@wagerwise/engine`; el
 * test `selection.test.ts` comprueba que ambos coinciden.
 */

import { z } from 'zod';

const goals = z.number().int().min(0).max(20);

/** Líneas de gol: sólo medios puntos y enteros, que es lo que cotizan las casas. */
const line = z
  .number()
  .min(0)
  .max(20)
  .refine((n) => Number.isInteger(n * 2), {
    message: 'La línea debe ser entera o terminar en .5',
  });

/** Hándicap asiático en pasos de medio gol, positivo o negativo. */
const handicapLine = z
  .number()
  .min(-10)
  .max(10)
  .refine((n) => Number.isInteger(n * 2), {
    message: 'El hándicap debe ir en pasos de 0.5',
  });

export const selectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('match_result'),
    outcome: z.enum(['home', 'draw', 'away']),
  }),
  z.object({
    kind: z.literal('double_chance'),
    outcome: z.enum(['home_draw', 'home_away', 'draw_away']),
  }),
  z.object({
    kind: z.literal('total_goals'),
    line,
    side: z.enum(['over', 'under']),
  }),
  z.object({
    kind: z.literal('team_total'),
    team: z.enum(['home', 'away']),
    line,
    side: z.enum(['over', 'under']),
  }),
  z.object({
    kind: z.literal('btts'),
    yes: z.boolean(),
  }),
  z.object({
    kind: z.literal('asian_handicap'),
    team: z.enum(['home', 'away']),
    line: handicapLine,
  }),
  z.object({
    kind: z.literal('correct_score'),
    homeGoals: goals,
    awayGoals: goals,
  }),
]);

export type SelectionInput = z.infer<typeof selectionSchema>;

/** Cuota decimal válida. Por debajo de 1.01 no existe mercado real. */
export const decimalOddsSchema = z.number().gt(1).lte(1000);

export const probabilitySchema = z.number().min(0).max(1);

/**
 * Clave estable de una selección, para deduplicar y comparar.
 * Dos selecciones equivalentes producen la misma clave.
 */
export function selectionKey(selection: SelectionInput): string {
  switch (selection.kind) {
    case 'match_result':
      return `1x2:${selection.outcome}`;
    case 'double_chance':
      return `dc:${selection.outcome}`;
    case 'total_goals':
      return `ou:${selection.line}:${selection.side}`;
    case 'team_total':
      return `tt:${selection.team}:${selection.line}:${selection.side}`;
    case 'btts':
      return `btts:${selection.yes ? 'yes' : 'no'}`;
    case 'asian_handicap':
      return `ah:${selection.team}:${selection.line}`;
    case 'correct_score':
      return `cs:${selection.homeGoals}-${selection.awayGoals}`;
  }
}
