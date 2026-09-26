/**
 * Tipos de dominio compartidos entre la app y el backend, y utilidades de
 * formato que ambos necesitan.
 */

import { z } from 'zod';
import { selectionSchema } from './selection.js';

export const riskProfileSchema = z.enum(['conservative', 'balanced', 'aggressive']);
export type RiskProfileId = z.infer<typeof riskProfileSchema>;

export const themePreferenceSchema = z.enum(['light', 'dark', 'system']);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

export const profileSettingsSchema = z.object({
  alerts: z.boolean().default(true),
  correlationAudit: z.boolean().default(true),
  stakeLimit: z.boolean().default(true),
  theme: themePreferenceSchema.default('system'),
});
export type ProfileSettings = z.infer<typeof profileSettingsSchema>;

export const profileSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().nullable(),
  currency: z.string().length(3),
  bankroll: z.number().nonnegative(),
  riskProfile: riskProfileSchema,
  followedLeagues: z.array(z.string()),
  isAdult: z.boolean(),
  onboardedAt: z.string().nullable(),
  settings: profileSettingsSchema,
  weeklyLimitPct: z.number().min(0).max(1),
});
export type Profile = z.infer<typeof profileSchema>;

export const fixtureSchema = z.object({
  id: z.string(),
  leagueId: z.string(),
  leagueName: z.string(),
  homeTeamId: z.string(),
  homeTeamName: z.string(),
  awayTeamId: z.string(),
  awayTeamName: z.string(),
  kickoffAt: z.string(),
  status: z.enum(['scheduled', 'live', 'finished', 'postponed', 'cancelled']),
  homeGoals: z.number().int().nullable(),
  awayGoals: z.number().int().nullable(),
});
export type Fixture = z.infer<typeof fixtureSchema>;

export const marketOfferSchema = z.object({
  selection: selectionSchema,
  odds: z.number().gt(1),
  bookmakerId: z.string().nullable(),
  modelProbability: z.number().min(0).max(1),
  marketProbability: z.number().min(0).max(1),
  blendedProbability: z.number().min(0).max(1),
  edge: z.number(),
  expectedValue: z.number(),
});
export type MarketOffer = z.infer<typeof marketOfferSchema>;

export const parlayTierSchema = z.enum(['safe', 'balanced', 'aggressive']);
export type ParlayTier = z.infer<typeof parlayTierSchema>;

/** Monedas soportadas, con los datos de formato de cada una. */
export const CURRENCIES = {
  COP: { code: 'COP', symbol: '$', locale: 'es-CO', decimals: 0 },
  USD: { code: 'USD', symbol: 'US$', locale: 'en-US', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', locale: 'es-ES', decimals: 2 },
  MXN: { code: 'MXN', symbol: 'MX$', locale: 'es-MX', decimals: 2 },
  BRL: { code: 'BRL', symbol: 'R$', locale: 'pt-BR', decimals: 2 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export function isCurrencyCode(value: string): value is CurrencyCode {
  return value in CURRENCIES;
}

/**
 * Formatea un importe en su moneda.
 *
 * El importe ya viene en la moneda indicada: aquí no se convierte nada. La
 * conversión, si hace falta, ocurre una sola vez y de forma explícita, para que
 * el bankroll nunca cambie de valor por un cambio de preferencia de la UI.
 */
export function formatMoney(amount: number, currency: CurrencyCode): string {
  const config = CURRENCIES[currency];
  const formatted = Math.abs(amount).toLocaleString(config.locale, {
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals,
  });
  return `${amount < 0 ? '-' : ''}${config.symbol}${formatted}`;
}

/** Porcentaje con un decimal, como lo muestra el diseño. */
export function formatPercent(fraction: number, decimals = 1): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Porcentaje con signo explícito, para EV. */
export function formatSignedPercent(fraction: number, decimals = 1): string {
  const value = (fraction * 100).toFixed(decimals);
  return fraction >= 0 ? `+${value}%` : `${value}%`;
}

/** Cuota decimal con dos decimales. */
export function formatOdds(odds: number): string {
  return odds.toFixed(2);
}
