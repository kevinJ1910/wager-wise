/**
 * Preferencias locales del dispositivo: tema y datos del onboarding antes de
 * que exista perfil en el servidor.
 *
 * El tema se guarda aquí y no sólo en `profiles` a propósito: debe aplicarse
 * antes de que haya sesión, en la pantalla de login.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RiskProfileId, ThemePreference } from '@wagerwise/core';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Los tres interruptores de Perfil.
 *
 * `correlationAudit` y `stakeLimit` sólo silencian avisos: el motor sigue
 * calculando la conjunta exacta y el EV corregido aunque estén apagados. Un
 * ajuste de la interfaz no puede cambiar cuánto vale un parlay.
 */
export interface UserSettings {
  alerts: boolean;
  correlationAudit: boolean;
  stakeLimit: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  alerts: true,
  correlationAudit: true,
  stakeLimit: true,
};

interface PreferencesState {
  theme: ThemePreference;
  /** Se rellena en el onboarding y se sincroniza al perfil al terminar. */
  bankroll: number;
  currency: string;
  riskProfile: RiskProfileId;
  followedLeagues: string[];
  /**
   * Tope de exposición semanal como fracción del bankroll. El diseño lo muestra
   * en Perfil; es un límite auto-impuesto de juego responsable.
   */
  weeklyLimitPct: number;
  settings: UserSettings;
  /** True cuando el usuario terminó o saltó el onboarding en este dispositivo. */
  onboarded: boolean;
  /** True mientras se rehidrata desde AsyncStorage. */
  hydrated: boolean;

  setTheme: (theme: ThemePreference) => void;
  setBankroll: (bankroll: number) => void;
  setCurrency: (currency: string) => void;
  setRiskProfile: (profile: RiskProfileId) => void;
  setWeeklyLimitPct: (pct: number) => void;
  toggleLeague: (league: string) => void;
  setSetting: (key: keyof UserSettings, value: boolean) => void;
  setOnboarded: (value: boolean) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'system',
      bankroll: 1_200_000,
      currency: 'COP',
      riskProfile: 'balanced',
      followedLeagues: ['La Liga', 'Premier'],
      weeklyLimitPct: 0.15,
      settings: DEFAULT_SETTINGS,
      onboarded: false,
      hydrated: false,

      setTheme: (theme) => set({ theme }),
      setBankroll: (bankroll) => set({ bankroll: Math.max(0, bankroll) }),
      setCurrency: (currency) => set({ currency }),

      // El perfil de riesgo fija también el stake por defecto, como en el diseño.
      setRiskProfile: (riskProfile) => set({ riskProfile }),

      setWeeklyLimitPct: (pct) => set({ weeklyLimitPct: Math.min(1, Math.max(0, pct)) }),

      toggleLeague: (league) =>
        set((state) => ({
          followedLeagues: state.followedLeagues.includes(league)
            ? state.followedLeagues.filter((l) => l !== league)
            : [...state.followedLeagues, league],
        })),

      setSetting: (key, value) =>
        set((state) => ({ settings: { ...state.settings, [key]: value } })),

      setOnboarded: (onboarded) => set({ onboarded }),
    }),
    {
      name: 'wagerwise:preferences',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => (state) => {
        // Sin esta bandera el primer render usaría los valores por defecto y el
        // tema parpadearía de claro a oscuro.
        state?.setTheme(state.theme);
        usePreferences.setState({ hydrated: true });
      },
    },
  ),
);

/** Stake por defecto de cada perfil, según el diseño. */
export const DEFAULT_STAKE_PCT: Record<RiskProfileId, number> = {
  conservative: 2,
  balanced: 4,
  aggressive: 8,
};
