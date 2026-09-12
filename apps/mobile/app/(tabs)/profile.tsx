/**
 * Perfil: bankroll, moneda, perfil de riesgo, tema y cierre de sesión.
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
import { Chip, Divider, GlassCard, Overline, Txt, useTheme } from '@wagerwise/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { useBuilder } from '@/state/builder';
import { usePreferences } from '@/state/preferences';

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Oscuro' },
  { id: 'system', label: 'Sistema' },
];

export default function ProfileRoute(): React.ReactElement {
  const { theme } = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuth();

  const preferences = usePreferences();
  const stakePct = useBuilder((s) => s.stakePct);
  const bankroll = preferences.bankroll;
  const currency = isCurrencyCode(preferences.currency) ? preferences.currency : 'COP';
  const profile = RISK_PROFILES[preferences.riskProfile];

  const exposure = (bankroll * stakePct) / 100;
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
              onValueChange={preferences.setBankroll}
              minimumTrackTintColor={theme.colors.accent}
              maximumTrackTintColor={theme.colors.hair}
              thumbTintColor={theme.colors.accent}
              accessibilityLabel="Bankroll"
            />
            <Txt variant="caption" tone="ink3">
              Límite semanal {formatMoney(bankroll * preferences.weeklyLimitPct, currency)} ·
              expuesto ahora {formatMoney(exposure, currency)}
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
                    onPress={() => preferences.setCurrency(code)}
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
                  onPress={() => preferences.setRiskProfile(id)}
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
  actionsCard: { paddingHorizontal: 17 },
  actionRow: { minHeight: 58, justifyContent: 'center' },
  legal: { paddingHorizontal: 6, paddingTop: 4 },
});
