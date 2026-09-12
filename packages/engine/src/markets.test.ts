import { describe, expect, it } from 'vitest';
import { scoreMatrixFromRates } from './dixon-coles.js';
import {
  jointProbability,
  matchResultProbabilities,
  resolveSelection,
  selectionCorrelation,
  selectionProbabilities,
  selectionProbability,
  type Selection,
} from './markets.js';

/** RNG determinista (mulberry32) para que el test Monte Carlo sea reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Muestrea un marcador de la matriz por el método de la CDF inversa. */
function sampleScore(
  matrix: readonly (readonly number[])[],
  rng: () => number,
): [number, number] {
  const u = rng();
  let acc = 0;
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h]!.length; a++) {
      acc += matrix[h]![a]!;
      if (u <= acc) return [h, a];
    }
  }
  return [matrix.length - 1, matrix[0]!.length - 1];
}

describe('resolución de selecciones', () => {
  it('resuelve 1X2', () => {
    const home: Selection = { kind: 'match_result', outcome: 'home' };
    expect(resolveSelection(home, 2, 1)).toBe('win');
    expect(resolveSelection(home, 1, 1)).toBe('loss');
    expect(resolveSelection(home, 0, 1)).toBe('loss');
  });

  it('resuelve doble oportunidad', () => {
    const dc: Selection = { kind: 'double_chance', outcome: 'home_draw' };
    expect(resolveSelection(dc, 2, 1)).toBe('win');
    expect(resolveSelection(dc, 1, 1)).toBe('win');
    expect(resolveSelection(dc, 0, 1)).toBe('loss');
  });

  it('resuelve over/under sin anulación en líneas .5', () => {
    const over: Selection = { kind: 'total_goals', line: 2.5, side: 'over' };
    expect(resolveSelection(over, 2, 1)).toBe('win');
    expect(resolveSelection(over, 1, 1)).toBe('loss');
  });

  it('anula el total en línea entera clavada', () => {
    const over: Selection = { kind: 'total_goals', line: 3, side: 'over' };
    expect(resolveSelection(over, 2, 1)).toBe('push');
    expect(resolveSelection(over, 3, 1)).toBe('win');
    expect(resolveSelection(over, 1, 1)).toBe('loss');
  });

  it('resuelve ambos marcan', () => {
    const btts: Selection = { kind: 'btts', yes: true };
    expect(resolveSelection(btts, 1, 1)).toBe('win');
    expect(resolveSelection(btts, 2, 0)).toBe('loss');
    expect(resolveSelection(btts, 0, 0)).toBe('loss');
  });

  it('resuelve hándicap asiático, incluida la anulación', () => {
    const minusOne: Selection = { kind: 'asian_handicap', team: 'home', line: -1 };
    expect(resolveSelection(minusOne, 2, 0)).toBe('win');
    expect(resolveSelection(minusOne, 1, 0)).toBe('push');
    expect(resolveSelection(minusOne, 1, 1)).toBe('loss');

    const plusHalf: Selection = { kind: 'asian_handicap', team: 'away', line: 0.5 };
    expect(resolveSelection(plusHalf, 1, 1)).toBe('win');
    expect(resolveSelection(plusHalf, 2, 1)).toBe('loss');
  });
});

describe('probabilidades de mercado', () => {
  const matrix = scoreMatrixFromRates(1.6, 1.1, -0.03, 12);

  it('la matriz suma 1', () => {
    const total = matrix.flat().reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('1X2 suma 1', () => {
    const { home, draw, away } = matchResultProbabilities(matrix);
    expect(home + draw + away).toBeCloseTo(1, 10);
  });

  it('el local es favorito cuando su tasa de goles es mayor', () => {
    const { home, away } = matchResultProbabilities(matrix);
    expect(home).toBeGreaterThan(away);
  });

  it('over y under de la misma línea suman 1', () => {
    const over = selectionProbability(matrix, { kind: 'total_goals', line: 2.5, side: 'over' });
    const under = selectionProbability(matrix, { kind: 'total_goals', line: 2.5, side: 'under' });
    expect(over + under).toBeCloseTo(1, 10);
  });

  it('win + push + loss siempre suma 1', () => {
    const s: Selection = { kind: 'asian_handicap', team: 'home', line: -1 };
    const { win, push, loss } = selectionProbabilities(matrix, s);
    expect(win + push + loss).toBeCloseTo(1, 10);
    expect(push).toBeGreaterThan(0);
  });

  it('una línea más alta hace el over menos probable', () => {
    const l25 = selectionProbability(matrix, { kind: 'total_goals', line: 2.5, side: 'over' });
    const l35 = selectionProbability(matrix, { kind: 'total_goals', line: 3.5, side: 'over' });
    expect(l35).toBeLessThan(l25);
  });
});

describe('probabilidad conjunta exacta', () => {
  const matrix = scoreMatrixFromRates(1.7, 1.2, -0.03, 12);

  it('con una sola selección coincide con la marginal', () => {
    const s: Selection = { kind: 'match_result', outcome: 'home' };
    expect(jointProbability(matrix, [s]).win).toBeCloseTo(selectionProbability(matrix, s), 12);
  });

  it('sin selecciones es 1', () => {
    expect(jointProbability(matrix, []).win).toBe(1);
  });

  it('selecciones mutuamente excluyentes dan 0', () => {
    const joint = jointProbability(matrix, [
      { kind: 'match_result', outcome: 'home' },
      { kind: 'match_result', outcome: 'away' },
    ]);
    expect(joint.win).toBe(0);
  });

  it('detecta correlación positiva entre ambos marcan y over 2.5', () => {
    // Es el caso que el diseño marca con correlación 0.71.
    const btts: Selection = { kind: 'btts', yes: true };
    const over: Selection = { kind: 'total_goals', line: 2.5, side: 'over' };

    const joint = jointProbability(matrix, [btts, over]).win;
    const naive = selectionProbability(matrix, btts) * selectionProbability(matrix, over);

    expect(joint).toBeGreaterThan(naive);
    expect(selectionCorrelation(matrix, btts, over)).toBeGreaterThan(0.3);
  });

  it('detecta correlación negativa entre gana el local y menos de 2.5', () => {
    const home: Selection = { kind: 'match_result', outcome: 'home' };
    const under: Selection = { kind: 'total_goals', line: 2.5, side: 'under' };
    expect(selectionCorrelation(matrix, home, under)).toBeLessThan(0);
  });

  it('la conjunta nunca supera a la menor de las marginales', () => {
    const a: Selection = { kind: 'match_result', outcome: 'home' };
    const b: Selection = { kind: 'total_goals', line: 2.5, side: 'over' };
    const joint = jointProbability(matrix, [a, b]).win;
    expect(joint).toBeLessThanOrEqual(selectionProbability(matrix, a) + 1e-12);
    expect(joint).toBeLessThanOrEqual(selectionProbability(matrix, b) + 1e-12);
  });

  /**
   * La prueba que de verdad importa: si `jointProbability` es correcta, debe
   * coincidir con la frecuencia observada al simular marcadores desde la misma
   * matriz. Es una verificación independiente del razonamiento analítico.
   */
  it('coincide con una simulación Monte Carlo', () => {
    const rng = makeRng(20260911);
    const draws = 400_000;

    const pairs: [Selection, Selection][] = [
      [
        { kind: 'match_result', outcome: 'home' },
        { kind: 'total_goals', line: 2.5, side: 'over' },
      ],
      [
        { kind: 'btts', yes: true },
        { kind: 'total_goals', line: 2.5, side: 'over' },
      ],
      [
        { kind: 'double_chance', outcome: 'home_draw' },
        { kind: 'total_goals', line: 3.5, side: 'under' },
      ],
      [
        { kind: 'asian_handicap', team: 'home', line: -0.5 },
        { kind: 'btts', yes: false },
      ],
    ];

    const hits = new Array(pairs.length).fill(0);

    for (let i = 0; i < draws; i++) {
      const [h, a] = sampleScore(matrix, rng);
      pairs.forEach(([s1, s2], idx) => {
        if (resolveSelection(s1, h, a) === 'win' && resolveSelection(s2, h, a) === 'win') {
          hits[idx]++;
        }
      });
    }

    pairs.forEach(([s1, s2], idx) => {
      const analytic = jointProbability(matrix, [s1, s2]).win;
      const simulated = hits[idx] / draws;
      // Error estándar de una binomial con 400k muestras es < 0.001; 0.005 de
      // tolerancia deja margen de sobra sin volver el test inútil.
      expect(simulated).toBeCloseTo(analytic, 2);
      expect(Math.abs(simulated - analytic)).toBeLessThan(0.005);
    });
  });

  it('reporta la probabilidad de anulación de una leg con hándicap entero', () => {
    const joint = jointProbability(matrix, [
      { kind: 'asian_handicap', team: 'home', line: -1 },
      { kind: 'btts', yes: true },
    ]);
    expect(joint.anyPush).toBeGreaterThan(0);
  });
});
