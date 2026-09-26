/**
 * Consenso de mercado: combina las cuotas de varias casas en un único
 * estimador de la probabilidad real.
 *
 * El consenso de un mercado líquido es difícil de batir. Es el mejor punto de
 * partida, y el modelo propio sólo debe moverlo en los márgenes.
 */

import { bookmakerMargin, netOdds, removeVigMultiplicative, removeVigShin } from './odds.js';

export type DevigMethod = 'multiplicative' | 'shin';

export interface BookQuote {
  /** Identificador de la casa (para trazabilidad y diagnóstico). */
  bookmaker: string;
  /** Cuotas decimales, en el mismo orden de resultados para todas las casas. */
  odds: number[];
  /**
   * Comisión sobre la ganancia neta, sólo en exchanges. No toca el consenso
   * —su precio bruto es precisamente el más limpio del mercado— pero sí la
   * mejor cuota: lo que importa ahí es lo que de verdad se cobra.
   */
  commission?: number;
}

export interface ConsensusResult {
  /** Probabilidades sin vig, ponderadas entre casas. Suman 1. */
  probabilities: number[];
  /** Margen medio observado, útil para descartar mercados caros. */
  averageMargin: number;
  /** Cuántas casas entraron en el cálculo. */
  bookmakerCount: number;
  /** La mejor cuota disponible por resultado, neta de comisión, con la casa que la ofrece. */
  bestOdds: { odds: number; bookmaker: string }[];
}

export interface ConsensusOptions {
  method?: DevigMethod;
  /**
   * Descarta casas cuyo margen supere este umbral. Un margen alto indica una
   * casa poco competitiva cuyo precio aporta ruido, no señal.
   */
  maxMargin?: number;
}

/**
 * Pondera cada casa por el inverso de su margen: las casas de margen bajo
 * (las "sharp") pesan más porque su precio está más cerca de la probabilidad
 * real.
 */
export function consensusProbabilities(
  quotes: readonly BookQuote[],
  options: ConsensusOptions = {},
): ConsensusResult {
  const { method = 'multiplicative', maxMargin = 0.12 } = options;

  if (quotes.length === 0) {
    throw new RangeError('Se necesita al menos una casa para calcular el consenso.');
  }

  const outcomes = quotes[0]!.odds.length;
  for (const q of quotes) {
    if (q.odds.length !== outcomes) {
      throw new RangeError(
        `La casa ${q.bookmaker} tiene ${q.odds.length} resultados; se esperaban ${outcomes}.`,
      );
    }
  }

  const usable = quotes.filter((q) => bookmakerMargin(q.odds) <= maxMargin);
  // Si todas superan el umbral nos quedamos con todas: es preferible un
  // consenso caro a no tener precio.
  const pool = usable.length > 0 ? usable : [...quotes];

  const devig = method === 'shin' ? removeVigShin : removeVigMultiplicative;

  let weightTotal = 0;
  const accumulated = new Array<number>(outcomes).fill(0);
  let marginTotal = 0;

  for (const q of pool) {
    const margin = bookmakerMargin(q.odds);
    marginTotal += margin;
    // Margen 0 daría peso infinito; el suelo lo mantiene acotado.
    const weight = 1 / Math.max(margin, 0.005);
    weightTotal += weight;

    const probs = devig(q.odds);
    for (let i = 0; i < outcomes; i++) {
      accumulated[i] = accumulated[i]! + probs[i]! * weight;
    }
  }

  const probabilities = accumulated.map((p) => p / weightTotal);
  const sum = probabilities.reduce((a, b) => a + b, 0);

  const payable = (q: BookQuote, i: number): number =>
    q.commission ? netOdds(q.odds[i]!, q.commission) : q.odds[i]!;

  const bestOdds = Array.from({ length: outcomes }, (_, i) => {
    let best = pool[0]!;
    for (const q of pool) {
      if (payable(q, i) > payable(best, i)) best = q;
    }
    return { odds: payable(best, i), bookmaker: best.bookmaker };
  });

  return {
    probabilities: probabilities.map((p) => p / sum),
    averageMargin: marginTotal / pool.length,
    bookmakerCount: pool.length,
    bestOdds,
  };
}
