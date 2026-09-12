import { describe, expect, it } from 'vitest';
import {
  expectedGoals,
  fitDixonColes,
  scoreMatrix,
  scoreMatrixFromRates,
  tau,
  type HistoricalMatch,
} from './dixon-coles.js';
import { matchResultProbabilities } from './markets.js';

const day = (offset: number): Date => new Date(2026, 0, 1 + offset);

/** RNG determinista para que la liga sintética sea siempre la misma. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Muestreo de Poisson por el método de Knuth. */
function samplePoisson(lambda: number, rng: () => number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

/**
 * Liga sintética donde conocemos la verdad: cada equipo tiene fuerzas
 * declaradas y los goles se muestrean de una Poisson con la tasa que esas
 * fuerzas implican. El ajuste debería recuperar el orden.
 *
 * Muestrear de verdad —en vez de redondear la tasa— importa: con redondeo,
 * equipos de fuerza distinta acaban produciendo marcadores idénticos y el test
 * no comprueba nada.
 */
const TRUE_TEAMS = [
  { id: 'fuerte', attack: 1.5, defence: 0.75 },
  { id: 'bueno', attack: 1.2, defence: 0.9 },
  { id: 'medio', attack: 0.95, defence: 1.05 },
  { id: 'flojo', attack: 0.7, defence: 1.35 },
] as const;

const TRUE_BASE_RATE = 1.35;
const TRUE_HOME_ADVANTAGE = 1.25;

function syntheticLeague(): HistoricalMatch[] {
  const rng = makeRng(987654321);
  const matches: HistoricalMatch[] = [];
  let counter = 0;

  // Todos contra todos, ida y vuelta, repetido para tener muestra suficiente.
  for (let round = 0; round < 10; round++) {
    for (const home of TRUE_TEAMS) {
      for (const away of TRUE_TEAMS) {
        if (home.id === away.id) continue;

        const lambda = TRUE_BASE_RATE * home.attack * away.defence * TRUE_HOME_ADVANTAGE;
        const mu = (TRUE_BASE_RATE * away.attack * home.defence) / TRUE_HOME_ADVANTAGE;

        matches.push({
          homeTeamId: home.id,
          awayTeamId: away.id,
          homeGoals: samplePoisson(lambda, rng),
          awayGoals: samplePoisson(mu, rng),
          date: day(counter),
        });
        counter++;
      }
    }
  }

  return matches;
}

describe('factor tau', () => {
  it('sólo altera los cuatro marcadores bajos', () => {
    const lambda = 1.5;
    const mu = 1.1;
    const rho = -0.05;

    expect(tau(0, 0, lambda, mu, rho)).not.toBe(1);
    expect(tau(0, 1, lambda, mu, rho)).not.toBe(1);
    expect(tau(1, 0, lambda, mu, rho)).not.toBe(1);
    expect(tau(1, 1, lambda, mu, rho)).not.toBe(1);

    expect(tau(2, 0, lambda, mu, rho)).toBe(1);
    expect(tau(1, 2, lambda, mu, rho)).toBe(1);
    expect(tau(3, 3, lambda, mu, rho)).toBe(1);
  });

  it('con rho cero es Poisson puro', () => {
    for (let h = 0; h < 3; h++) {
      for (let a = 0; a < 3; a++) {
        expect(tau(h, a, 1.5, 1.1, 0)).toBe(1);
      }
    }
  });

  it('con rho negativo sube los empates bajos frente a Poisson', () => {
    const withRho = scoreMatrixFromRates(1.4, 1.2, -0.05, 10);
    const plain = scoreMatrixFromRates(1.4, 1.2, 0, 10);
    expect(withRho[0]![0]!).toBeGreaterThan(plain[0]![0]!);
  });
});

describe('matriz de marcadores', () => {
  it('suma 1 exactamente', () => {
    const matrix = scoreMatrixFromRates(1.7, 1.3, -0.03, 12);
    const total = matrix.flat().reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 12);
  });

  it('todas las celdas son probabilidades válidas', () => {
    const matrix = scoreMatrixFromRates(2.4, 0.6, -0.08, 12);
    for (const row of matrix) {
      for (const p of row) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it('sigue sumando 1 aunque se trunque bajo', () => {
    // La renormalización tiene que absorber la cola cortada.
    const matrix = scoreMatrixFromRates(3.5, 3.0, -0.02, 5);
    const total = matrix.flat().reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 12);
  });

  it('tasas más altas desplazan masa a marcadores altos', () => {
    const low = scoreMatrixFromRates(0.8, 0.7, -0.03, 12);
    const high = scoreMatrixFromRates(2.5, 2.2, -0.03, 12);
    expect(high[0]![0]!).toBeLessThan(low[0]![0]!);
  });
});

describe('ajuste del modelo', () => {
  const matches = syntheticLeague();
  const model = fitDixonColes(matches, { asOf: day(100), halfLifeDays: 400 });

  it('ajusta todos los equipos vistos', () => {
    expect(model.ratings.size).toBe(4);
    expect(model.sampleSize).toBe(matches.length);
  });

  it('recupera el orden de fuerza ofensiva', () => {
    const attack = (id: string): number => model.ratings.get(id)!.attack;
    expect(attack('fuerte')).toBeGreaterThan(attack('bueno'));
    expect(attack('bueno')).toBeGreaterThan(attack('medio'));
    expect(attack('medio')).toBeGreaterThan(attack('flojo'));
  });

  it('recupera el orden de solidez defensiva', () => {
    const defence = (id: string): number => model.ratings.get(id)!.defence;
    // Defensa más baja = concede menos.
    expect(defence('fuerte')).toBeLessThan(defence('flojo'));
    expect(defence('bueno')).toBeLessThan(defence('flojo'));
  });

  it('recupera la tasa base de la liga', () => {
    // baseRate es la media ponderada por recencia. Con una vida media enorme
    // los pesos son prácticamente 1, así que debe coincidir con la media simple.
    const flat = fitDixonColes(matches, { asOf: day(200), halfLifeDays: 1e9 });
    const observed =
      matches.reduce((acc, m) => acc + m.homeGoals + m.awayGoals, 0) / (2 * matches.length);

    expect(flat.baseRate).toBeCloseTo(observed, 6);
    // El ajuste con decaimiento normal se mantiene en el mismo orden de magnitud.
    expect(model.baseRate).toBeCloseTo(observed, 1);
  });

  it('normaliza las fuerzas alrededor de 1', () => {
    const attacks = [...model.ratings.values()].map((r) => r.attack);
    const mean = attacks.reduce((a, b) => a + b, 0) / attacks.length;
    expect(mean).toBeCloseTo(1, 6);
  });

  it('detecta ventaja de local positiva', () => {
    expect(model.homeAdvantage).toBeGreaterThan(1);
  });

  it('produce tasas de goles positivas y razonables', () => {
    const { lambda, mu } = expectedGoals(model, 'fuerte', 'flojo');
    expect(lambda).toBeGreaterThan(0);
    expect(mu).toBeGreaterThan(0);
    expect(lambda).toBeLessThan(8);
    expect(lambda).toBeGreaterThan(mu);
  });

  it('hace favorito al equipo fuerte contra el flojo', () => {
    const matrix = scoreMatrix(model, 'fuerte', 'flojo', 12);
    const { home, away } = matchResultProbabilities(matrix);
    expect(home).toBeGreaterThan(away);
  });

  it('rechaza equipos desconocidos en vez de inventar una predicción', () => {
    expect(() => expectedGoals(model, 'fuerte', 'inexistente')).toThrow(RangeError);
  });

  it('rechaza un histórico vacío', () => {
    expect(() => fitDixonColes([])).toThrow(RangeError);
  });

  it('es determinista: dos ajustes iguales dan el mismo resultado', () => {
    const a = fitDixonColes(matches, { asOf: day(100), halfLifeDays: 400 });
    const b = fitDixonColes(matches, { asOf: day(100), halfLifeDays: 400 });
    for (const [id, rating] of a.ratings) {
      expect(b.ratings.get(id)!.attack).toBeCloseTo(rating.attack, 12);
      expect(b.ratings.get(id)!.defence).toBeCloseTo(rating.defence, 12);
    }
  });

  it('da más peso a los partidos recientes', () => {
    // Un equipo que empieza flojo y acaba fuerte debe puntuar mejor con una
    // vida media corta que con una larga.
    const evolving: HistoricalMatch[] = [];
    for (let i = 0; i < 20; i++) {
      evolving.push({
        homeTeamId: 'evoluciona',
        awayTeamId: 'rival',
        homeGoals: i < 10 ? 0 : 4,
        awayGoals: i < 10 ? 2 : 0,
        date: day(i),
      });
      evolving.push({
        homeTeamId: 'rival',
        awayTeamId: 'evoluciona',
        homeGoals: 1,
        awayGoals: i < 10 ? 0 : 3,
        date: day(i),
      });
    }

    const shortMemory = fitDixonColes(evolving, { asOf: day(20), halfLifeDays: 4 });
    const longMemory = fitDixonColes(evolving, { asOf: day(20), halfLifeDays: 500 });

    expect(shortMemory.ratings.get('evoluciona')!.attack).toBeGreaterThan(
      longMemory.ratings.get('evoluciona')!.attack,
    );
  });
});
