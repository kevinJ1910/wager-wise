import { describe, expect, it } from 'vitest';
import {
  RISK_PROFILES,
  blendProbabilities,
  edge,
  expectedValue,
  kellyFraction,
  recommendStake,
} from './value.js';

describe('mezcla de probabilidades', () => {
  it('con peso 0 devuelve el mercado', () => {
    expect(blendProbabilities(0.7, 0.5, 0)).toBe(0.5);
  });

  it('con peso 1 devuelve el modelo', () => {
    expect(blendProbabilities(0.7, 0.5, 1)).toBe(0.7);
  });

  it('queda entre ambos con peso intermedio', () => {
    const blended = blendProbabilities(0.7, 0.5, 0.35);
    expect(blended).toBeGreaterThan(0.5);
    expect(blended).toBeLessThan(0.7);
    expect(blended).toBeCloseTo(0.57, 10);
  });

  it('rechaza pesos fuera de rango', () => {
    expect(() => blendProbabilities(0.5, 0.5, 1.5)).toThrow(RangeError);
    expect(() => blendProbabilities(0.5, 0.5, -0.1)).toThrow(RangeError);
  });
});

describe('ventaja y esperanza', () => {
  it('la ventaja es cero en una apuesta justa', () => {
    expect(edge(0.5, 2)).toBeCloseTo(0, 12);
  });

  it('la esperanza es cero en una apuesta justa', () => {
    expect(expectedValue(0.5, 2)).toBeCloseTo(0, 12);
  });

  it('detecta valor positivo', () => {
    // 54% real contra cuota 1.95 (51.3% implícito) es el caso del mockup.
    expect(expectedValue(0.54, 1.95)).toBeGreaterThan(0);
    expect(edge(0.54, 1.95)).toBeGreaterThan(0);
  });

  it('detecta valor negativo', () => {
    expect(expectedValue(0.45, 1.95)).toBeLessThan(0);
  });

  it('la anulación no suma ni resta esperanza', () => {
    // Con 100% de anulación la esperanza es exactamente 0: devuelven el stake.
    expect(expectedValue(0, 2, 1)).toBeCloseTo(0, 12);
  });

  it('la anulación parcial mejora la esperanza frente a perder', () => {
    const withPush = expectedValue(0.4, 2, 0.2);
    const withoutPush = expectedValue(0.4, 2, 0);
    expect(withPush).toBeGreaterThan(withoutPush);
  });
});

describe('criterio de Kelly', () => {
  it('no recomienda apostar sin ventaja', () => {
    expect(kellyFraction(0.5, 2)).toBe(0);
    expect(kellyFraction(0.4, 2)).toBe(0);
  });

  it('calcula la fracción clásica', () => {
    // p=0.6, b=1 -> f = (1*0.6 - 0.4)/1 = 0.2
    expect(kellyFraction(0.6, 2)).toBeCloseTo(0.2, 12);
  });

  it('crece con la ventaja', () => {
    expect(kellyFraction(0.7, 2)).toBeGreaterThan(kellyFraction(0.6, 2));
  });

  it('devuelve 0 con cuota imposible', () => {
    expect(kellyFraction(0.9, 1)).toBe(0);
  });
});

describe('recomendación de stake', () => {
  const bankroll = 1_200_000;

  it('aplica la fracción del perfil', () => {
    const balanced = recommendStake(0.6, 2, bankroll, RISK_PROFILES.balanced);
    expect(balanced.fullKelly).toBeCloseTo(0.2, 10);
    // 0.2 * 1/4 = 0.05, justo en el tope del perfil balanceado.
    expect(balanced.fraction).toBeCloseTo(0.05, 10);
  });

  it('el conservador arriesga menos que el agresivo', () => {
    const cons = recommendStake(0.6, 2, bankroll, RISK_PROFILES.conservative);
    const aggr = recommendStake(0.6, 2, bankroll, RISK_PROFILES.aggressive);
    expect(cons.fraction).toBeLessThan(aggr.fraction);
  });

  it('nunca supera el tope del perfil, pase lo que pase', () => {
    // Ventaja enorme: Kelly completo pediría una barbaridad.
    for (const profile of Object.values(RISK_PROFILES)) {
      const rec = recommendStake(0.95, 5, bankroll, profile);
      expect(rec.fraction).toBeLessThanOrEqual(profile.maxStakePct);
      expect(rec.amount).toBeLessThanOrEqual(bankroll * profile.maxStakePct);
      expect(rec.cappedByProfile).toBe(true);
    }
  });

  it('no recomienda nada sin ventaja', () => {
    const rec = recommendStake(0.45, 2, bankroll, RISK_PROFILES.balanced);
    expect(rec.fraction).toBe(0);
    expect(rec.amount).toBe(0);
  });

  it('escala el importe con el bankroll', () => {
    const small = recommendStake(0.6, 2, 100_000, RISK_PROFILES.balanced);
    const large = recommendStake(0.6, 2, 1_000_000, RISK_PROFILES.balanced);
    expect(large.amount).toBeCloseTo(small.amount * 10, 6);
  });
});
