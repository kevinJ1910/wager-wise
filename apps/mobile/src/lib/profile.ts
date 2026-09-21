/**
 * El perfil del servidor y su sincronización con las preferencias locales.
 *
 * Hay dos copias del bankroll y los ajustes a propósito: la local, que existe
 * antes de que haya sesión y sobrevive sin red, y la del servidor, que es la
 * que viaja entre dispositivos. La regla para que no se peleen es simple: **el
 * servidor gana al entrar** (una sola vez por sesión) y **el usuario gana al
 * tocar** (cada cambio escribe en las dos). Nunca hay un efecto que copie en
 * ambas direcciones, que es como se montan los bucles de sincronización.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  profileSettingsSchema,
  riskProfileSchema,
  type ProfileSettings,
  type RiskProfileId,
} from '@wagerwise/core';
import { useEffect, useRef } from 'react';
import { useAuth } from './auth.js';
import { isBackendConfigured, supabase } from './supabase.js';
import { DEFAULT_SETTINGS, usePreferences, type UserSettings } from '@/state/preferences';

export interface ServerProfile {
  id: string;
  displayName: string | null;
  currency: string;
  bankroll: number;
  riskProfile: RiskProfileId;
  followedLeagues: string[];
  weeklyLimitPct: number;
  settings: ProfileSettings;
  onboardedAt: string | null;
}

export function useServerProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['profile', user?.id],
    enabled: isBackendConfigured && Boolean(user?.id),
    queryFn: () => fetchProfile(user!.id),
  });
}

async function fetchProfile(userId: string): Promise<ServerProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, display_name, currency, bankroll, risk_profile, followed_leagues, weekly_limit_pct, settings, onboarded_at',
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(`No se pudo leer el perfil: ${error.message}`);
  if (!data) return null;

  const row = data as ProfileRow;
  const settings = profileSettingsSchema.safeParse(row.settings);
  const risk = riskProfileSchema.safeParse(row.risk_profile);

  return {
    id: row.id,
    displayName: row.display_name,
    currency: row.currency,
    bankroll: Number(row.bankroll),
    // Un enum que el cliente no reconoce significa que el servidor va por
    // delante; caer al perfil medio es más seguro que reventar la pantalla.
    riskProfile: risk.success ? risk.data : 'balanced',
    followedLeagues: row.followed_leagues ?? [],
    weeklyLimitPct: row.weekly_limit_pct,
    settings: settings.success
      ? settings.data
      : { ...DEFAULT_SETTINGS, theme: 'system' as const },
    onboardedAt: row.onboarded_at,
  };
}

// ─────────────────────────────────────────────────────────────
// Escritura
// ─────────────────────────────────────────────────────────────

export interface ProfilePatch {
  bankroll?: number;
  currency?: string;
  riskProfile?: RiskProfileId;
  followedLeagues?: string[];
  weeklyLimitPct?: number;
  settings?: UserSettings;
  onboardedAt?: string;
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: ProfilePatch): Promise<void> => {
      if (!isBackendConfigured || !user?.id) return;

      const row: Record<string, unknown> = {};
      if (patch.bankroll !== undefined) row.bankroll = patch.bankroll;
      if (patch.currency !== undefined) row.currency = patch.currency;
      if (patch.riskProfile !== undefined) row.risk_profile = patch.riskProfile;
      if (patch.followedLeagues !== undefined) row.followed_leagues = patch.followedLeagues;
      if (patch.weeklyLimitPct !== undefined) row.weekly_limit_pct = patch.weeklyLimitPct;
      if (patch.onboardedAt !== undefined) row.onboarded_at = patch.onboardedAt;
      if (patch.settings !== undefined) {
        // `settings` es jsonb entero: se manda completo, con el tema incluido,
        // para no borrar claves que el servidor ya tenía.
        row.settings = { ...patch.settings, theme: usePreferences.getState().theme };
      }

      if (Object.keys(row).length === 0) return;

      const { error } = await supabase.from('profiles').update(row).eq('id', user.id);
      if (error) throw new Error(`No se pudo guardar el perfil: ${error.message}`);
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile', user?.id] });
    },
  });
}

/**
 * Cambia una preferencia en local y en el servidor a la vez.
 *
 * Optimista: la UI se mueve al instante y el servidor va detrás. Si falla, la
 * siguiente lectura del perfil corrige — no merece la pena revertir un slider
 * bajo el dedo del usuario.
 */
export function usePreferenceWriter() {
  const update = useUpdateProfile();

  return (patch: ProfilePatch): void => {
    const state = usePreferences.getState();

    if (patch.bankroll !== undefined) state.setBankroll(patch.bankroll);
    if (patch.currency !== undefined) state.setCurrency(patch.currency);
    if (patch.riskProfile !== undefined) state.setRiskProfile(patch.riskProfile);
    if (patch.weeklyLimitPct !== undefined) state.setWeeklyLimitPct(patch.weeklyLimitPct);
    if (patch.settings !== undefined) usePreferences.setState({ settings: patch.settings });

    update.mutate(patch);
  };
}

// ─────────────────────────────────────────────────────────────
// Sincronización de entrada
// ─────────────────────────────────────────────────────────────

/**
 * Trae el perfil del servidor a las preferencias locales, una sola vez por
 * usuario y sesión.
 *
 * El `ref` no es una optimización: sin él, cada refetch de react-query
 * sobreescribiría lo que el usuario acabara de cambiar en pantalla.
 */
export function useProfileSync(): void {
  const { data } = useServerProfile();
  const applied = useRef<string | null>(null);

  useEffect(() => {
    if (!data || applied.current === data.id) return;
    applied.current = data.id;

    const { theme: _theme, ...toggles } = data.settings;

    usePreferences.setState({
      bankroll: data.bankroll,
      currency: data.currency,
      riskProfile: data.riskProfile,
      weeklyLimitPct: data.weeklyLimitPct,
      settings: toggles,
      // Las ligas seguidas sólo se adoptan si el servidor tiene alguna: un
      // array vacío suele ser un perfil recién creado, no una elección.
      ...(data.followedLeagues.length > 0 ? { followedLeagues: data.followedLeagues } : {}),
    });
  }, [data]);
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  currency: string;
  bankroll: string | number;
  risk_profile: string;
  followed_leagues: string[] | null;
  weekly_limit_pct: number;
  settings: unknown;
  onboarded_at: string | null;
}
