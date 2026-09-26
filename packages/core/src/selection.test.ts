import { resolveSelection, type Selection } from '@wagerwise/engine';
import { describe, expect, it } from 'vitest';
import { selectionKey, selectionSchema, type SelectionInput } from './selection.js';

/**
 * Comprobación en tiempo de compilación de que el esquema zod y el tipo del
 * motor describen exactamente lo mismo. Si alguien añade un mercado en un sitio
 * y no en el otro, esto deja de compilar.
 */
type AssertAssignable<A extends B, B> = true;
type _SchemaMatchesEngine = AssertAssignable<SelectionInput, Selection>;
type _EngineMatchesSchema = AssertAssignable<Selection, SelectionInput>;

const valid: SelectionInput[] = [
  { kind: 'match_result', outcome: 'home' },
  { kind: 'double_chance', outcome: 'home_draw' },
  { kind: 'total_goals', line: 2.5, side: 'over' },
  { kind: 'team_total', team: 'home', line: 1.5, side: 'over' },
  { kind: 'btts', yes: true },
  { kind: 'asian_handicap', team: 'home', line: -1 },
  { kind: 'correct_score', homeGoals: 2, awayGoals: 1 },
];

describe('esquema de selección', () => {
  it('acepta todas las variantes soportadas', () => {
    for (const selection of valid) {
      expect(selectionSchema.parse(selection)).toEqual(selection);
    }
  });

  it('las selecciones validadas las entiende el motor', () => {
    // Cierra el círculo: lo que pasa el esquema es ejecutable por el motor.
    for (const selection of valid) {
      const parsed = selectionSchema.parse(selection);
      expect(['win', 'push', 'loss']).toContain(resolveSelection(parsed, 2, 1));
    }
  });

  it('rechaza un tipo de mercado desconocido', () => {
    expect(selectionSchema.safeParse({ kind: 'goleador_exacto' }).success).toBe(false);
  });

  it('rechaza líneas de gol que no son enteras ni .5', () => {
    expect(
      selectionSchema.safeParse({ kind: 'total_goals', line: 2.3, side: 'over' }).success,
    ).toBe(false);
    expect(
      selectionSchema.safeParse({ kind: 'total_goals', line: 2.5, side: 'over' }).success,
    ).toBe(true);
  });

  it('rechaza hándicaps fuera de los pasos de medio gol', () => {
    expect(
      selectionSchema.safeParse({ kind: 'asian_handicap', team: 'home', line: -0.25 }).success,
    ).toBe(false);
  });

  it('rechaza un resultado inválido en 1X2', () => {
    expect(
      selectionSchema.safeParse({ kind: 'match_result', outcome: 'empate' }).success,
    ).toBe(false);
  });

  it('rechaza marcadores exactos negativos', () => {
    expect(
      selectionSchema.safeParse({ kind: 'correct_score', homeGoals: -1, awayGoals: 0 }).success,
    ).toBe(false);
  });
});

describe('clave de selección', () => {
  it('da claves distintas a selecciones distintas', () => {
    const keys = valid.map(selectionKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('da la misma clave a selecciones equivalentes', () => {
    expect(selectionKey({ kind: 'total_goals', line: 2.5, side: 'over' })).toBe(
      selectionKey({ kind: 'total_goals', line: 2.5, side: 'over' }),
    );
  });

  it('distingue over de under en la misma línea', () => {
    expect(selectionKey({ kind: 'total_goals', line: 2.5, side: 'over' })).not.toBe(
      selectionKey({ kind: 'total_goals', line: 2.5, side: 'under' }),
    );
  });
});
