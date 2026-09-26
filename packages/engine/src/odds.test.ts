import { describe, expect, it } from 'vitest';
import {
  bookmakerMargin,
  decimalToImplied,
  impliedToDecimal,
  overround,
  removeVigMultiplicative,
  removeVigShin,
} from './odds.js';

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('conversión de cuotas', () => {
  it('convierte cuota a probabilidad implícita', () => {
    expect(decimalToImplied(2)).toBe(0.5);
    expect(decimalToImplied(4)).toBe(0.25);
  });

  it('ida y vuelta es la identidad', () => {
    for (const odds of [1.2, 1.95, 3.4, 11]) {
      expect(impliedToDecimal(decimalToImplied(odds))).toBeCloseTo(odds, 12);
    }
  });

  it('rechaza cuotas imposibles', () => {
    expect(() => decimalToImplied(1)).toThrow(RangeError);
    expect(() => decimalToImplied(0.5)).toThrow(RangeError);
    expect(() => decimalToImplied(Number.NaN)).toThrow(RangeError);
  });
});

describe('margen de la casa', () => {
  it('es cero en un mercado justo', () => {
    // Moneda justa: 2.0 / 2.0 suma exactamente 1.
    expect(bookmakerMargin([2, 2])).toBeCloseTo(0, 12);
  });

  it('detecta el margen de un 1X2 real', () => {
    // Cuotas del mockup para Betis-Girona.
    const margin = bookmakerMargin([1.95, 3.4, 3.8]);
    expect(margin).toBeGreaterThan(0.03);
    expect(margin).toBeLessThan(0.08);
  });

  it('overround de un mercado con margen supera 1', () => {
    expect(overround([1.95, 3.4, 3.8])).toBeGreaterThan(1);
  });
});

describe('de-vig multiplicativo', () => {
  it('produce probabilidades que suman 1', () => {
    const probs = removeVigMultiplicative([1.95, 3.4, 3.8]);
    expect(sum(probs)).toBeCloseTo(1, 12);
  });

  it('deja intacto un mercado ya justo', () => {
    const probs = removeVigMultiplicative([2, 2]);
    expect(probs[0]).toBeCloseTo(0.5, 12);
    expect(probs[1]).toBeCloseTo(0.5, 12);
  });

  it('mantiene el orden de los favoritos', () => {
    const probs = removeVigMultiplicative([1.95, 3.4, 3.8]);
    expect(probs[0]!).toBeGreaterThan(probs[1]!);
    expect(probs[1]!).toBeGreaterThan(probs[2]!);
  });

  it('baja cada probabilidad respecto a la implícita con vig', () => {
    const odds = [1.95, 3.4, 3.8];
    const probs = removeVigMultiplicative(odds);
    odds.forEach((o, i) => {
      expect(probs[i]!).toBeLessThan(decimalToImplied(o));
    });
  });

  it('exige al menos dos resultados', () => {
    expect(() => removeVigMultiplicative([2])).toThrow(RangeError);
  });
});

describe('de-vig de Shin', () => {
  it('produce probabilidades que suman 1', () => {
    const probs = removeVigShin([1.95, 3.4, 3.8]);
    expect(sum(probs)).toBeCloseTo(1, 9);
  });

  it('converge también en mercados de dos vías', () => {
    const probs = removeVigShin([1.5, 2.5]);
    expect(sum(probs)).toBeCloseTo(1, 9);
    expect(probs[0]!).toBeGreaterThan(probs[1]!);
  });

  it('corrige el sesgo favorito-perdedor respecto al multiplicativo', () => {
    // Las casas acortan las cuotas de los no-favoritos más de lo que justifica
    // su probabilidad real. El reparto proporcional no lo corrige; Shin sí:
    // quita más margen al longshot, así que al favorito le queda más
    // probabilidad y al no-favorito menos.
    const odds = [1.3, 5.5, 11];
    const shin = removeVigShin(odds);
    const mult = removeVigMultiplicative(odds);

    expect(shin[0]!).toBeGreaterThan(mult[0]!);
    expect(shin[2]!).toBeLessThan(mult[2]!);
    expect(sum(shin)).toBeCloseTo(1, 9);
  });

  it('no rompe cuando el mercado no tiene margen', () => {
    const probs = removeVigShin([2, 2]);
    expect(sum(probs)).toBeCloseTo(1, 9);
  });
});
