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

  // El bucle trabaja sobre índices y arrays tipados en vez de mapas por id: el
  // backtesting reajusta el modelo cientos de veces seguidas y aquí se va casi
  // todo su tiempo. Pesos e índices se calculan una vez, no en cada iteración.
  const ids = [...teamIds];
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const homeIndex = Int32Array.from(matches, (m) => indexOf.get(m.homeTeamId)!);
  const awayIndex = Int32Array.from(matches, (m) => indexOf.get(m.awayTeamId)!);
  const weights = Float64Array.from(matches, weightOf);

  const teams = ids.length;
  const att = new Float64Array(teams).fill(1);
  const def = new Float64Array(teams).fill(1);
  const attackScored = new Float64Array(teams);
  const attackExpected = new Float64Array(teams);
  const defenceConceded = new Float64Array(teams);
  const defenceExpected = new Float64Array(teams);

  for (let iter = 0; iter < iterations; iter++) {
    attackScored.fill(0);
    attackExpected.fill(0);
    defenceConceded.fill(0);
    defenceExpected.fill(0);

    for (let k = 0; k < matches.length; k++) {
      const m = matches[k]!;
      const w = weights[k]!;
      const h = homeIndex[k]!;
      const a = awayIndex[k]!;

      const lambda = baseRate * att[h]! * def[a]! * homeAdvantage;
      const mu = (baseRate * att[a]! * def[h]!) / homeAdvantage;

      attackScored[h]! += w * m.homeGoals;
      attackExpected[h]! += w * lambda;
      attackScored[a]! += w * m.awayGoals;
      attackExpected[a]! += w * mu;

      defenceConceded[h]! += w * m.awayGoals;
      defenceExpected[h]! += w * mu;
      defenceConceded[a]! += w * m.homeGoals;
      defenceExpected[a]! += w * lambda;
    }

    for (let t = 0; t < teams; t++) {
      if (attackExpected[t]! > 0) {
        att[t] = clamp((att[t]! * attackScored[t]!) / attackExpected[t]!, 0.2, 5);
      }
      if (defenceExpected[t]! > 0) {
        def[t] = clamp((def[t]! * defenceConceded[t]!) / defenceExpected[t]!, 0.2, 5);
      }
    }

    // Normalización: las fuerzas son relativas a la liga, así que su media debe
    // quedar en 1. Sin esto, ataque y defensa derivan juntos sin cambiar las
    // predicciones y el modelo deja de ser interpretable.
    normalizeArrayToMeanOne(att);
    normalizeArrayToMeanOne(def);
  }

  const attack = new Map(ids.map((id, i) => [id, att[i]!]));
  const defence = new Map(ids.map((id, i) => [id, def[i]!]));

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

function normalizeArrayToMeanOne(values: Float64Array): void {
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  if (mean <= 0) return;
  for (let i = 0; i < values.length; i++) values[i] = values[i]! / mean;
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
