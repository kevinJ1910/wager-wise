/**
 * Conversión de cuotas y eliminación del margen de la casa (de-vig).
 *
 * Las cuotas publicadas por una casa suman más de 100% en probabilidad
 * implícita: ese exceso es su margen. Antes de comparar contra el modelo hay
 * que quitarlo, o todo mercado parece tener valor negativo.
 */

/** Probabilidad implícita (con vig) de una cuota decimal. */
export function decimalToImplied(odds: number): number {
  if (!Number.isFinite(odds) || odds <= 1) {
    throw new RangeError(`Cuota decimal inválida: ${odds}. Debe ser > 1.`);
  }
  return 1 / odds;
}

/** Cuota decimal justa para una probabilidad. */
export function impliedToDecimal(p: number): number {
  if (!(p > 0 && p < 1)) {
    throw new RangeError(`Probabilidad inválida: ${p}. Debe estar en (0, 1).`);
  }
  return 1 / p;
}

/** Suma de probabilidades implícitas de un mercado completo (el "overround"). */
export function overround(decimalOdds: readonly number[]): number {
  assertMarket(decimalOdds);
  return decimalOdds.reduce((sum, o) => sum + decimalToImplied(o), 0);
}

/**
 * Margen de la casa. Un mercado 1X2 típico ronda 0.04–0.07 (4–7%).
 * Devuelve 0 para un mercado perfectamente justo.
 */
export function bookmakerMargin(decimalOdds: readonly number[]): number {
  return overround(decimalOdds) - 1;
}

/**
 * De-vig multiplicativo: divide cada probabilidad implícita por el overround.
 *
 * Es el método estándar y el más robusto cuando no se conoce la estructura del
 * margen. Asume que la casa aplica el margen proporcionalmente a cada
 * resultado, lo que subestima ligeramente a los favoritos (favourite-longshot
 * bias). Para mercados con un favorito muy marcado, `removeVigShin` corrige
 * mejor.
 */
export function removeVigMultiplicative(decimalOdds: readonly number[]): number[] {
  assertMarket(decimalOdds);
  const total = overround(decimalOdds);
  return decimalOdds.map((o) => decimalToImplied(o) / total);
}

/**
 * De-vig por el método de Shin.
 *
 * Modela el margen como consecuencia de apostadores informados: estima la
 * proporción `z` de dinero informado y despeja las probabilidades reales.
 * Corrige el sesgo favorito-perdedor que deja el método multiplicativo.
 *
 * Resuelve z por bisección sobre [0, 0.5), que es monótona y siempre converge
 * en este rango — más estable que Newton-Raphson, que puede divergir cuando el
 * overround es pequeño.
 */
export function removeVigShin(decimalOdds: readonly number[], tolerance = 1e-10): number[] {
  assertMarket(decimalOdds);
  const implied = decimalOdds.map(decimalToImplied);
  const total = implied.reduce((a, b) => a + b, 0);

  // Sin margen (o negativo, que pasa con cuotas de casas distintas) no hay nada
  // que corregir: normalizamos y salimos.
  if (total <= 1 + tolerance) {
    return implied.map((p) => p / total);
  }

  const shinProbs = (z: number): number[] =>
    implied.map((p) => (Math.sqrt(z * z + 4 * (1 - z) * (p * p) / total) - z) / (2 * (1 - z)));

  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const sum = shinProbs(mid).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) < tolerance) {
      lo = mid;
      break;
    }
    // La suma decrece de forma monótona al crecer z.
    if (sum > 1) lo = mid;
    else hi = mid;
  }

  const probs = shinProbs(lo);
  // Renormalización final: absorbe el error residual de la bisección para que
  // el resultado sume exactamente 1.
  const sum = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / sum);
}

function assertMarket(decimalOdds: readonly number[]): void {
  if (decimalOdds.length < 2) {
    throw new RangeError('Un mercado necesita al menos dos resultados para quitar el vig.');
  }
}
