import { describe, expect, it } from 'vitest';
import { consensusProbabilities } from './consensus.js';
import { netOdds } from './odds.js';

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('consensusProbabilities', () => {
  it('devuelve probabilidades que suman 1', () => {
    const result = consensusProbabilities([
      { bookmaker: 'a', odds: [2.1, 3.4, 3.6] },
      { bookmaker: 'b', odds: [2.05, 3.5, 3.7] },
    ]);
    expect(sum(result.probabilities)).toBeCloseTo(1, 12);
    expect(result.bookmakerCount).toBe(2);
  });

  it('pesa más la casa de margen bajo', () => {
    // La casa afilada dice 50/50; la cara, 60/40. El consenso queda más cerca
    // de la afilada.
    const result = consensusProbabilities([
      { bookmaker: 'afilada', odds: [1.98, 1.98] },
      { bookmaker: 'cara', odds: [1.55, 2.3] },
    ]);
    expect(result.probabilities[0]!).toBeLessThan(0.55);
  });

  it('elige la mejor cuota por resultado', () => {
    const result = consensusProbabilities([
      { bookmaker: 'a', odds: [2.1, 3.4, 3.6] },
      { bookmaker: 'b', odds: [2.05, 3.5, 3.7] },
    ]);
    expect(result.bestOdds.map((b) => b.bookmaker)).toEqual(['a', 'b', 'b']);
  });

  it('rechaza casas con distinto número de resultados', () => {
    expect(() =>
      consensusProbabilities([
        { bookmaker: 'a', odds: [2, 2] },
        { bookmaker: 'b', odds: [2, 3, 4] },
      ]),
    ).toThrow(RangeError);
  });
});

describe('comisión de los exchanges', () => {
  it('descuenta la comisión sólo de la ganancia', () => {
    expect(netOdds(2.1, 0.05)).toBeCloseTo(2.045, 12);
    expect(netOdds(2.1, 0)).toBe(2.1);
  });

  it('rechaza comisiones imposibles', () => {
    expect(() => netOdds(2, 1)).toThrow(RangeError);
    expect(() => netOdds(2, -0.1)).toThrow(RangeError);
  });

  it('un exchange no gana la mejor cuota si neto de comisión paga menos', () => {
    const result = consensusProbabilities([
      { bookmaker: 'casa', odds: [2.06, 1.84] },
      { bookmaker: 'exchange', odds: [2.1, 1.92], commission: 0.05 },
    ]);
    // 2.10 con un 5% paga 2.045, menos que los 2.06 de la casa.
    expect(result.bestOdds[0]).toEqual({ odds: 2.06, bookmaker: 'casa' });
    // Y si gana, se reporta lo que de verdad cobra, no el precio bruto.
    expect(result.bestOdds[1]!.bookmaker).toBe('exchange');
    expect(result.bestOdds[1]!.odds).toBeCloseTo(netOdds(1.92, 0.05), 12);
  });

  it('la comisión no mueve el consenso', () => {
    const quotes = [
      { bookmaker: 'casa', odds: [2.06, 1.84] },
      { bookmaker: 'exchange', odds: [2.1, 1.92] },
    ];
    const without = consensusProbabilities(quotes);
    const withCommission = consensusProbabilities([
      quotes[0]!,
      { ...quotes[1]!, commission: 0.05 },
    ]);
    expect(withCommission.probabilities).toEqual(without.probabilities);
  });
});
