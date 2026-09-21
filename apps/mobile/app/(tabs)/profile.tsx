/**
 * Perfil: bankroll, moneda, perfil de riesgo, límites, ajustes y sesión.
 *
 * Cada cambio se escribe en local y en el servidor a la vez (`usePreferenceWriter`).
 * El bankroll es un valor declarado por el usuario, no un saldo: WagerWise no
 * mueve dinero, así que ganar una apuesta no lo sube solo. Lo que sí se calcula
 * de verdad es la exposición —el dinero que tiene comprometido ahora mismo— y
 * el gasto de la semana, que salen del historial real.
 */

import Slider from '@react-native-community/slider';
import {
  CURRENCIES,
  formatMoney,
  formatPercent,
  isCurrencyCode,
  type RiskProfileId,
  type ThemePreference,
} from '@wagerwise/core';
import { RISK_PROFILES } from '@wagerwise/engine';
import { Chip, Divider, GlassCard, Overline, Toggle, Txt, useTheme } from '@wagerwise/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { useBets } from '@/lib/bets';
import { usePreferenceWriter } from '@/lib/profile';
import { registerPushToken, unregisterPushToken } from '@/lib/push';
import { usePreferences, type UserSettings } from '@/state/preferences';

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Oscuro' },
  { id: 'system', label: 'Sistema' },
];

const SETTING_COPY: Record<keyof UserSettings, { name: string; desc: string }> = {
  alerts: {
    name: 'Alertas de valor',
    desc: 'Aviso diario cuando el modelo encuentra EV por encima del 5%',
  },
  correlationAudit: {
    name: 'Auditor de correlación',
    desc: 'Avisa cuando dos legs son del mismo partido. El EV se corrige siempre, lo apagues o no',
  },
  stakeLimit: {
    name: 'Límite de stake',
    desc: 'Avisa si pasas del máximo por apuesta de tu perfil',
  },
};

export default function ProfileRoute(): React.ReactElement {
  const { theme } = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuth();

  const preferences = usePreferences();
  const write = usePreferenceWriter();
  const { bets, stats } = useBets();

  const bankroll = preferences.bankroll;
  const currency = isCurrencyCode(preferences.currency) ? preferences.currency : 'COP';
  const profile = RISK_PROFILES[preferences.riskProfile];

  const weeklySpend = spentThisWeek(bets);
  const weeklyLimit = bankroll * preferences.weeklyLimitPct;

  const initials = (user?.email ?? 'W')
    .replace(/@.*/, '')
    .slice(0, 2)
    .toUpperCase();

  function confirmSignOut(): void {
    Alert.alert('Cerrar sesión', '¿Seguro que quieres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  }

  /**
   * Encender las alertas pide permiso de notificaciones ahí mismo.
   *
   * Si el sistema lo deniega —o estamos en Expo Go, que ya no entrega push
   * remoto— el interruptor vuelve atrás y se dice por qué, en vez de quedarse
   * encendido prometiendo avisos que no van a llegar.
   */
  function toggleSetting(key: keyof UserSettings): void {
    const next = { ...preferences.settings, [key]: !preferences.settings[key] };
    write({ settings: next });

    if (key !== 'alerts') return;

    if (next.alerts) {
      void registerPushToken().then((result) => {
        if (result.ok) return;
        write({ settings: { ...next, alerts: false } });
        Alert.alert(
          'Alertas no disponibles',
          result.reason === 'denied'
            ? 'Activa las notificaciones para WagerWise en los ajustes del sistema.'
            : (result.detail ?? 'Este dispositivo no puede recibir notificaciones push.'),
        );
      });
    } else {
      void unregisterPushToken();
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Overline>Cuenta</Overline>
          <Txt variant="display" style={styles.title}>
            Perfil y bankroll
          </Txt>
        </View>

        <GlassCard variant="hero" style={styles.card}>
          <View style={styles.identity}>
            <View style={[styles.avatar, { backgroundColor: theme.colors.accent }]}>
              <Txt variant="title" style={styles.avatarText}>
                {initials}
              </Txt>
            </View>
            <View style={styles.identityText}>
              <Txt variant="title" numberOfLines={1}>
                {user?.email ?? 'Invitado'}
              </Txt>
              <Txt variant="caption" tone="ink3">
                Perfil {profile.label} · Kelly 1/{Math.round(1 / profile.kellyFraction)}
              </Txt>
            </View>
          </View>

          <View style={styles.bankrollBlock}>
            <View style={styles.bankrollHeader}>
              <Overline>Bankroll</Overline>
              <Txt variant="heroSmall">{formatMoney(bankroll, currency)}</Txt>
            </View>
            <Slider
              minimumValue={200_000}
              maximumValue={20_000_000}
              step={100_000}
              value={bankroll}
              onSlidingComplete={(value) => write({ bankroll: value })}
              onValueChange={preferences.setBankroll}
              minimumTrackTintColor={theme.colors.accent}
              maximumTrackTintColor={theme.colors.hair}
              thumbTintColor={theme.colors.accent}
              accessibilityLabel="Bankroll"
            />
            <Txt variant="caption" tone="ink3">
              Límite semanal {formatMoney(weeklyLimit, currency)} · esta semana llevas{' '}
              {formatMoney(weeklySpend, currency)}
            </Txt>
            {weeklySpend > weeklyLimit ? (
              <Txt variant="caption" tone="warn">
                Has pasado tu límite semanal auto-impuesto.
              </Txt>
            ) : null}
            <Txt variant="caption" tone="ink3">
              Expuesto ahora {formatMoney(stats.openStake, currency)} en{' '}
              {stats.open === 1 ? '1 apuesta abierta' : `${stats.open} apuestas abiertas`}
            </Txt>
          </View>

          <View style={styles.block}>
            <Overline>Moneda</Overline>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {Object.keys(CURRENCIES).map((code) => (
                  <Chip
                    key={code}
                    label={code}
                    active={preferences.currency === code}
                    onPress={() => write({ currency: code })}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        </GlassCard>

        <GlassCard variant="card" style={styles.card}>
          <View style={styles.block}>
            <Overline>Perfil de riesgo</Overline>
            <View style={styles.chipRow}>
              {(Object.keys(RISK_PROFILES) as RiskProfileId[]).map((id) => (
                <Chip
                  key={id}
                  label={RISK_PROFILES[id].label}
                  active={preferences.riskProfile === id}
                  onPress={() => write({ riskProfile: id })}
                />
              ))}
            </View>
            <Txt variant="caption" tone="ink2">
              Máximo {formatPercent(profile.maxStakePct, 0)} del bankroll por apuesta y{' '}
              {profile.maxLegs} legs. El auditor avisa si lo superas.
            </Txt>
          </View>

          <Divider />

          <View style={styles.block}>
            <Overline>Tema</Overline>
            <View style={styles.chipRow}>
              {THEME_OPTIONS.map((option) => (
                <Chip
                  key={option.id}
                  label={option.label}
                  active={preferences.theme === option.id}
                  onPress={() => preferences.setTheme(option.id)}
                />
              ))}
            </View>
          </View>
        </GlassCard>

        <GlassCard variant="card" style={styles.settingsCard}>
          {(Object.keys(SETTING_COPY) as (keyof UserSettings)[]).map((key, index) => (
            <View key={key}>
              {index > 0 ? <Divider /> : null}
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Txt variant="bodySmall">{SETTING_COPY[key].name}</Txt>
                  <Txt variant="caption" tone="ink3">
                    {SETTING_COPY[key].desc}
                  </Txt>
                </View>
                <Toggle
                  value={preferences.settings[key]}
                  onToggle={() => toggleSetting(key)}
                  label={SETTING_COPY[key].name}
                />
              </View>
            </View>
          ))}
        </GlassCard>

        <GlassCard variant="card" style={styles.actionsCard}>
          <Pressable
            onPress={() => {
              preferences.setOnboarded(false);
              router.replace('/onboarding');
            }}
            accessibilityRole="button"
            style={styles.actionRow}
          >
            <Txt variant="bodySmall" tone="accent">
              Repetir onboarding
            </Txt>
          </Pressable>

          <Divider />

          <Pressable onPress={confirmSignOut} accessibilityRole="button" style={styles.actionRow}>
            <Txt variant="bodySmall" tone="ink2">
              Cerrar sesión
            </Txt>
          </Pressable>
        </GlassCard>

        <Txt variant="caption" tone="ink3" style={styles.legal}>
          Juega con responsabilidad. Las probabilidades del modelo son estimaciones, no garantías.
          18+
        </Txt>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Stake comprometido en los últimos siete días.
 *
 * Cuenta desde que se registró la apuesta, no desde que se liquidó: el límite
 * semanal es un tope de exposición, y lo que lo consume es apostar.
 */
function spentThisWeek(bets: { stake: number; placedAt: Date }[]): number {
  const since = Date.now() - 7 * 86_400_000;
  return bets
    .filter((bet) => bet.placedAt.getTime() >= since)
    .reduce((total, bet) => total + bet.stake, 0);
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingBottom: 24, gap: 15 },
  header: { paddingHorizontal: 4, gap: 7 },
  title: {},
  card: { padding: 22, gap: 20 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF' },
  identityText: { flex: 1, gap: 3 },
  bankrollBlock: { gap: 4 },
  bankrollHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  block: { gap: 9 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  settingsCard: { paddingHorizontal: 18, paddingVertical: 4 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 64,
    paddingVertical: 12,
  },
  settingText: { flex: 1, gap: 4 },
  actionsCard: { paddingHorizontal: 17 },
  actionRow: { minHeight: 58, justifyContent: 'center' },
  legal: { paddingHorizontal: 6, paddingTop: 4 },
});
