/**
 * Modelo Dixon-Coles: Poisson bivariado con corrección para marcadores bajos.
 *
 * Poisson simple subestima sistemáticamente 0-0, 1-0, 0-1 y 1-1 porque asume
 * independencia entre los goles de cada equipo, y en la realidad los equipos
 * ajustan su juego según el marcador. Dixon y Coles (1997) añaden el factor
 * `tau` que corrige exactamente esas cuatro celdas.
 *
 * La salida es una *matriz de marcadores*: P(goles_local = h, goles_visita = a).
 * Todos los mercados se derivan de ella, y por eso las probabilidades conjuntas
 * de dos selecciones del mismo partido salen exactas (ver `markets.ts`).
 */

export interface HistoricalMatch {
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
  /** Fecha del partido; se usa para el decaimiento por recencia. */
  date: Date;
}

export interface TeamRating {
  teamId: string;
  /** Fuerza ofensiva; >1 marca más que la media de la liga. */
  attack: number;
  /** Fuerza defensiva; <1 concede menos que la media. */
  defence: number;
}

export interface DixonColesModel {
  ratings: Map<string, TeamRating>;
  /** Ventaja de jugar en casa, como multiplicador de la tasa de goles. */
  homeAdvantage: number;
  /** Parámetro de dependencia para marcadores bajos. Típicamente negativo. */
  rho: number;
  /** Media de goles de la liga, usada como base de las tasas. */
  baseRate: number;
  /** Cuántos partidos entraron en el ajuste (para bandas de confianza). */
  sampleSize: number;
}

export interface FitOptions {
  /**
   * Vida media en días del peso por recencia. Un partido de hace `halfLifeDays`
   * pesa la mitad que uno de hoy. Dixon-Coles original usa ~0.0065/día, que
   * equivale a ~107 días.
   */
  halfLifeDays?: number;
  /** Fecha de referencia para el decaimiento. Por defecto, ahora. */
  asOf?: Date;
  /** Iteraciones del ajuste iterativo. */
  iterations?: number;
  rho?: number;
  /**
   * Fuerza del encogimiento hacia la media de la liga, medida en partidos.
   *
   * Un equipo con esta cantidad de partidos efectivos conserva la mitad de su
   * desviación respecto a 1; con menos, se le acerca más. Existe porque el
   * ajuste tiene dos parámetros libres por equipo y en septiembre hay ocho o
   * nueve partidos jugados: sin encoger, una goleada temprana convierte a un
   * equipo en tres veces la media de la liga y la probabilidad resultante deja
   * de ser creíble. Poner 0 desactiva el encogimiento.
   */
  priorMatches?: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Factor de corrección de Dixon-Coles. Sólo actúa sobre los cuatro marcadores
 * bajos; para el resto devuelve 1 y la matriz queda Poisson pura.
 */
export function tau(
  homeGoals: number,
  awayGoals: number,
  lambda: number,
  mu: number,
  rho: number,
): number {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambda * mu * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambda * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + mu * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // Vía logaritmos: evita desbordar el factorial para k grande.
  return Math.exp(k * Math.log(lambda) - lambda - logFactorial(k));
}

const logFactorialCache = [0, 0];
function logFactorial(n: number): number {
  if (n < logFactorialCache.length) return logFactorialCache[n]!;
  let result = logFactorialCache[logFactorialCache.length - 1]!;
  for (let i = logFactorialCache.length; i <= n; i++) {
    result += Math.log(i);
    logFactorialCache[i] = result;
  }
  return result;
}

/**
 * Ajusta fuerzas de ataque y defensa por equipo.
 *
 * Usa escalado iterativo proporcional en lugar de maximizar la verosimilitud
 * por gradiente: converge en pocas pasadas, no necesita derivadas ni tuning de
 * paso, y es determinista — lo que importa para poder testearlo.
 */
export function fitDixonColes(
  matches: readonly HistoricalMatch[],
  options: FitOptions = {},
): DixonColesModel {
  const {
    halfLifeDays = 107,
    asOf = new Date(),
    iterations = 60,
    rho = -0.03,
    priorMatches = 12,
  } = options;

  if (matches.length === 0) {
    throw new RangeError('No hay partidos históricos para ajustar el modelo.');
  }

  const decay = Math.log(2) / halfLifeDays;
  const weightOf = (m: HistoricalMatch): number => {
    const ageDays = Math.max(0, (asOf.getTime() - m.date.getTime()) / MS_PER_DAY);
    return Math.exp(-decay * ageDays);
  };

  const teamIds = new Set<string>();
  for (const m of matches) {
    teamIds.add(m.homeTeamId);
    teamIds.add(m.awayTeamId);
  }

  let weightSum = 0;
  let weightedGoals = 0;
  let weightedHomeGoals = 0;
  let weightedAwayGoals = 0;
  for (const m of matches) {
    const w = weightOf(m);
    weightSum += w;
    weightedGoals += w * (m.homeGoals + m.awayGoals);
    weightedHomeGoals += w * m.homeGoals;
    weightedAwayGoals += w * m.awayGoals;
  }

  const baseRate = weightedGoals / (2 * weightSum);
  // Ventaja de local medida directamente de los datos, no asumida.
  const homeAdvantage =
    weightedAwayGoals > 0 ? Math.sqrt(weightedHomeGoals / weightedAwayGoals) : 1;

  const attack = new Map<string, number>();
  const defence = new Map<string, number>();
  for (const id of teamIds) {
    attack.set(id, 1);
    defence.set(id, 1);
  }

  for (let iter = 0; iter < iterations; iter++) {
    const attackScored = new Map<string, number>();
    const attackExpected = new Map<string, number>();
    const defenceConceded = new Map<string, number>();
    const defenceExpected = new Map<string, number>();
    for (const id of teamIds) {
      attackScored.set(id, 0);
      attackExpected.set(id, 0);
      defenceConceded.set(id, 0);
      defenceExpected.set(id, 0);
    }

    for (const m of matches) {
      const w = weightOf(m);
      const ah = attack.get(m.homeTeamId)!;
      const aa = attack.get(m.awayTeamId)!;
      const dh = defence.get(m.homeTeamId)!;
      const da = defence.get(m.awayTeamId)!;

      const lambda = baseRate * ah * da * homeAdvantage;
      const mu = (baseRate * aa * dh) / homeAdvantage;

      attackScored.set(m.homeTeamId, attackScored.get(m.homeTeamId)! + w * m.homeGoals);
      attackExpected.set(m.homeTeamId, attackExpected.get(m.homeTeamId)! + w * lambda);
      attackScored.set(m.awayTeamId, attackScored.get(m.awayTeamId)! + w * m.awayGoals);
      attackExpected.set(m.awayTeamId, attackExpected.get(m.awayTeamId)! + w * mu);

      defenceConceded.set(m.homeTeamId, defenceConceded.get(m.homeTeamId)! + w * m.awayGoals);
      defenceExpected.set(m.homeTeamId, defenceExpected.get(m.homeTeamId)! + w * mu);
      defenceConceded.set(m.awayTeamId, defenceConceded.get(m.awayTeamId)! + w * m.homeGoals);
      defenceExpected.set(m.awayTeamId, defenceExpected.get(m.awayTeamId)! + w * lambda);
    }

    for (const id of teamIds) {
      const ae = attackExpected.get(id)!;
      if (ae > 0) {
        attack.set(id, clamp((attack.get(id)! * attackScored.get(id)!) / ae, 0.2, 5));
      }
      const de = defenceExpected.get(id)!;
      if (de > 0) {
        defence.set(id, clamp((defence.get(id)! * defenceConceded.get(id)!) / de, 0.2, 5));
      }
    }

    // Normalización: las fuerzas son relativas a la liga, así que su media debe
    // quedar en 1. Sin esto, ataque y defensa derivan juntos sin cambiar las
    // predicciones y el modelo deja de ser interpretable.
    normalizeToMeanOne(attack);
    normalizeToMeanOne(defence);
  }

  // El encogimiento va al final, sobre el ajuste ya convergido: durante las
  // iteraciones sesgaría el reparto de goles esperados entre equipos.
  if (priorMatches > 0) {
    const exposure = effectiveMatches(matches, weightOf, teamIds);
    shrinkToMeanOne(attack, exposure, priorMatches);
    shrinkToMeanOne(defence, exposure, priorMatches);
  }

  const ratings = new Map<string, TeamRating>();
  for (const id of teamIds) {
    ratings.set(id, { teamId: id, attack: attack.get(id)!, defence: defence.get(id)! });
  }

  return { ratings, homeAdvantage, rho, baseRate, sampleSize: matches.length };
}

/**
 * Partidos efectivos de cada equipo: la suma de los pesos por recencia, no el
 * conteo. Una temporada entera de hace un año aporta mucho menos que cinco
 * jornadas recientes, y es esa exposición real la que decide cuánto se encoge.
 */
function effectiveMatches(
  matches: readonly HistoricalMatch[],
  weightOf: (m: HistoricalMatch) => number,
  teamIds: Set<string>,
): Map<string, number> {
  const exposure = new Map<string, number>();
  for (const id of teamIds) exposure.set(id, 0);

  for (const m of matches) {
    const w = weightOf(m);
    exposure.set(m.homeTeamId, exposure.get(m.homeTeamId)! + w);
    exposure.set(m.awayTeamId, exposure.get(m.awayTeamId)! + w);
  }

  return exposure;
}

/**
 * Acerca cada fuerza a 1 según la muestra que la respalda, y renormaliza.
 *
 * Es el estimador de James-Stein aplicado a un caso donde el sobreajuste es la
 * norma: con poca muestra la media de la liga predice mejor que el dato propio
 * del equipo, y con mucha el dato propio manda.
 */
function shrinkToMeanOne(
  map: Map<string, number>,
  exposure: Map<string, number>,
  priorMatches: number,
): void {
  for (const [id, value] of map) {
    const n = exposure.get(id) ?? 0;
    const weight = n / (n + priorMatches);
    map.set(id, 1 + (value - 1) * weight);
  }

  normalizeToMeanOne(map);
}

function normalizeToMeanOne(map: Map<string, number>): void {
  let sum = 0;
  for (const v of map.values()) sum += v;
  const mean = sum / map.size;
  if (mean <= 0) return;
  for (const [k, v] of map) map.set(k, v / mean);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Tasas esperadas de goles (lambda local, mu visitante) para un enfrentamiento. */
export function expectedGoals(
  model: DixonColesModel,
  homeTeamId: string,
  awayTeamId: string,
): { lambda: number; mu: number } {
  const home = model.ratings.get(homeTeamId);
  const away = model.ratings.get(awayTeamId);
  if (!home) throw new RangeError(`Equipo desconocido para el modelo: ${homeTeamId}`);
  if (!away) throw new RangeError(`Equipo desconocido para el modelo: ${awayTeamId}`);

  return {
    lambda: model.baseRate * home.attack * away.defence * model.homeAdvantage,
    mu: (model.baseRate * away.attack * home.defence) / model.homeAdvantage,
  };
}

/**
 * Matriz de marcadores. `matrix[h][a]` = P(local marca h, visita marca a).
 *
 * Se renormaliza al final para que sume exactamente 1: truncar en `maxGoals`
 * deja fuera una cola pequeña pero no nula, y sin renormalizar todas las
 * probabilidades derivadas quedarían sesgadas a la baja.
 */
export function scoreMatrix(
  model: DixonColesModel,
  homeTeamId: string,
  awayTeamId: string,
  maxGoals = 10,
): number[][] {
  const { lambda, mu } = expectedGoals(model, homeTeamId, awayTeamId);
  return scoreMatrixFromRates(lambda, mu, model.rho, maxGoals);
}

/** Matriz de marcadores a partir de tasas directas. Útil para tests y simulación. */
export function scoreMatrixFromRates(
  lambda: number,
  mu: number,
  rho: number,
  maxGoals = 10,
): number[][] {
  const size = maxGoals + 1;
  const matrix: number[][] = [];
  let total = 0;

  for (let h = 0; h < size; h++) {
    const row = new Array<number>(size);
    for (let a = 0; a < size; a++) {
      // tau puede volverse negativo con rho extremo; el suelo en 0 mantiene la
      // matriz como una distribución de probabilidad válida.
      const p = poissonPmf(h, lambda) * poissonPmf(a, mu) * Math.max(0, tau(h, a, lambda, mu, rho));
      row[a] = p;
      total += p;
    }
    matrix.push(row);
  }

  for (let h = 0; h < size; h++) {
    for (let a = 0; a < size; a++) {
      matrix[h]![a] = matrix[h]![a]! / total;
    }
  }

  return matrix;
}
