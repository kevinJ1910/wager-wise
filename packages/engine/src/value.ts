/**
 * Cálculo de valor: ventaja, esperanza matemática y tamaño de apuesta.
 */

/** Perfiles de riesgo del onboarding, con su fracción de Kelly. */
export const RISK_PROFILES = {
  conservative: { id: 'conservative', label: 'Conservador', kellyFraction: 1 / 8, maxLegs: 3, maxStakePct: 0.02 },
  balanced: { id: 'balanced', label: 'Balanceado', kellyFraction: 1 / 4, maxLegs: 4, maxStakePct: 0.05 },
  aggressive: { id: 'aggressive', label: 'Agresivo', kellyFraction: 1 / 2, maxLegs: 5, maxStakePct: 0.08 },
} as const;

export type RiskProfileId = keyof typeof RISK_PROFILES;
export type RiskProfile = (typeof RISK_PROFILES)[RiskProfileId];

/**
 * Mezcla la probabilidad del modelo con el consenso de mercado.
 *
 * El mercado es difícil de batir, así que por defecto pesa más (65%). El
 * modelo aporta en los márgenes. `modelWeight` debe calibrarse contra el
 * histórico (ver el backtesting), no elegirse a ojo.
 */
export function blendProbabilities(
  modelProbability: number,
  marketProbability: number,
  modelWeight = 0.35,
): number {
  if (modelWeight < 0 || modelWeight > 1) {
    throw new RangeError(`modelWeight debe estar en [0, 1], recibido ${modelWeight}`);
  }
  return modelWeight * modelProbability + (1 - modelWeight) * marketProbability;
}

/** Ventaja sobre la cuota ofrecida: probabilidad real menos implícita. */
export function edge(probability: number, decimalOdds: number): number {
  return probability - 1 / decimalOdds;
}

/**
 * Esperanza matemática por unidad apostada.
 *
 * Con `pushProbability` el stake se devuelve, así que ese escenario no suma ni
 * resta: sólo reduce el peso de ganar y perder.
 */
export function expectedValue(
  winProbability: number,
  decimalOdds: number,
  pushProbability = 0,
): number {
  const lossProbability = 1 - winProbability - pushProbability;
  return winProbability * (decimalOdds - 1) - lossProbability;
}

/**
 * Fracción de Kelly completa: la proporción del bankroll que maximiza el
 * crecimiento logarítmico. Devuelve 0 cuando no hay ventaja — Kelly nunca
 * recomienda apostar sin edge.
 */
export function kellyFraction(winProbability: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const q = 1 - winProbability;
  const f = (b * winProbability - q) / b;
  return Math.max(0, f);
}

export interface StakeRecommendation {
  /** Fracción del bankroll recomendada, ya acotada por el perfil. */
  fraction: number;
  amount: number;
  /** Kelly completo antes de aplicar la fracción del perfil y el tope. */
  fullKelly: number;
  /** True si el tope del perfil recortó la recomendación. */
  cappedByProfile: boolean;
}

/**
 * Stake sugerido: Kelly fraccionado según el perfil y acotado por el tope duro
 * del mismo. El diseño promete que "nunca verás una recomendación por encima de
 * tu límite", y este tope es lo que lo garantiza.
 */
export function recommendStake(
  winProbability: number,
  decimalOdds: number,
  bankroll: number,
  profile: RiskProfile,
): StakeRecommendation {
  const fullKelly = kellyFraction(winProbability, decimalOdds);
  const scaled = fullKelly * profile.kellyFraction;
  const fraction = Math.min(scaled, profile.maxStakePct);

  return {
    fraction,
    amount: bankroll * fraction,
    fullKelly,
    cappedByProfile: scaled > profile.maxStakePct,
  };
}
