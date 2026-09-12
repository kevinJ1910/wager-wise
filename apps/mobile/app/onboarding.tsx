/**
 * Onboarding en tres pasos: bankroll, ligas y perfil de riesgo.
 *
 * Al terminar sincroniza el perfil en Supabase. Si esa escritura falla se
 * continúa igualmente con las preferencias locales: no tiene sentido bloquear
 * al usuario en el onboarding por un fallo de red, y el perfil se puede
 * reconciliar después.
 */

import Slider from '@react-native-community/slider';
import { CURRENCIES, formatMoney, isCurrencyCode, type RiskProfileId } from '@wagerwise/core';
import { RISK_PROFILES } from '@wagerwise/engine';
import { Button, Chip, GlassCard, Overline, Txt, useTheme } from '@wagerwise/ui';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { DEFAULT_STAKE_PCT, usePreferences } from '@/state/preferences';
import { useBuilder } from '@/state/builder';

const LEAGUES = ['La Liga', 'Premier', 'Serie A', 'Bundesliga', 'Ligue 1', 'Champions'];

const STEPS = [
  {
    title: 'Tu bankroll manda',
    body: 'Todo el análisis se calibra a tu capital. El stake sugerido nunca superará tu límite.',
  },
  {
    title: 'Elige tus ligas',
    body: 'Solo recibirás alertas de valor de las competiciones que sigues.',
  },
  {
    title: 'Perfil de riesgo',
    body: 'Define cuánto de tu ventaja quieres jugar en cada apuesta.',
  },
] as const;

export default function OnboardingRoute(): React.ReactElement {
  const router = useRouter();
  const { theme } = useTheme();
  const { user } = useAuth();

  const preferences = usePreferences();
  const setStakePct = useBuilder((s) => s.setStakePct);

  const [step, setStep] = useState(0);
  const current = STEPS[step]!;

  const currency = isCurrencyCode(preferences.currency) ? preferences.currency : 'COP';

  async function finish(): Promise<void> {
    preferences.setOnboarded(true);
    setStakePct(DEFAULT_STAKE_PCT[preferences.riskProfile]);

    if (user) {
      const { error } = await supabase
        .from('profiles')
        .update({
          bankroll: preferences.bankroll,
          currency: preferences.currency,
          risk_profile: preferences.riskProfile,
          followed_leagues: preferences.followedLeagues,
          is_adult: true,
          onboarded_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      // Un fallo aquí no debe atrapar al usuario: seguimos con lo local.
      if (error) console.warn('No se pudo sincronizar el perfil:', error.message);
    }

    router.replace('/(tabs)');
  }

  function next(): void {
    if (step === STEPS.length - 1) {
      void finish();
      return;
    }
    setStep((s) => s + 1);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.dots}>
          {STEPS.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                {
                  width: index === step ? 26 : 8,
                  backgroundColor: index === step ? theme.colors.accent : theme.colors.hair,
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.intro}>
          <Txt variant="displayLarge" style={styles.stepTitle}>
            {current.title}
          </Txt>
          <Txt variant="body" tone="ink2" style={styles.stepBody}>
            {current.body}
          </Txt>
        </View>

        {step === 0 ? (
          <GlassCard variant="hero" style={styles.card}>
            <Overline>Bankroll inicial</Overline>
            <Txt variant="hero" style={styles.bankroll}>
              {formatMoney(preferences.bankroll, currency)}
            </Txt>
            <Slider
              minimumValue={200_000}
              maximumValue={20_000_000}
              step={100_000}
              value={preferences.bankroll}
              onValueChange={preferences.setBankroll}
              minimumTrackTintColor={theme.colors.accent}
              maximumTrackTintColor={theme.colors.hair}
              thumbTintColor={theme.colors.accent}
              accessibilityLabel="Bankroll inicial"
            />
            <Txt variant="bodySmall" tone="ink2">
              Usamos tu bankroll para calcular el stake sugerido con Kelly fraccionado. Nunca verás
              una recomendación por encima de tu límite.
            </Txt>

            <View style={styles.currencyBlock}>
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
        ) : null}

        {step === 1 ? (
          <View style={styles.leagueGrid}>
            {LEAGUES.map((league) => (
              <Chip
                key={league}
                label={league}
                active={preferences.followedLeagues.includes(league)}
                onPress={() => preferences.toggleLeague(league)}
              />
            ))}
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.riskList}>
            {(Object.keys(RISK_PROFILES) as RiskProfileId[]).map((id) => {
              const profile = RISK_PROFILES[id];
              const selected = preferences.riskProfile === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => preferences.setRiskProfile(id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <GlassCard variant="card" selected={selected} style={styles.riskCard}>
                    <View style={styles.riskHeader}>
                      <Txt variant="title">{profile.label}</Txt>
                      <Txt variant="bodySmall" tone="accent">
                        Kelly 1/{Math.round(1 / profile.kellyFraction)}
                      </Txt>
                    </View>
                    <Txt variant="bodySmall" tone="ink2">
                      {describeProfile(id)}
                    </Txt>
                  </GlassCard>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button label={step === STEPS.length - 1 ? 'Empezar' : 'Continuar'} onPress={next} />
          <Pressable
            onPress={() => void finish()}
            accessibilityRole="button"
            style={styles.skip}
          >
            <Txt variant="bodySmall" tone="ink3">
              Saltar
            </Txt>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function describeProfile(id: RiskProfileId): string {
  return {
    conservative: 'Stakes pequeños, solo EV alto y máximo 3 legs.',
    balanced: 'Equilibrio entre frecuencia y varianza. Recomendado.',
    aggressive: 'Más parlays y más varianza. Requiere bankroll estable.',
  }[id];
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 30, gap: 26, flexGrow: 1 },
  dots: { flexDirection: 'row', gap: 7 },
  dot: { height: 8, borderRadius: 4 },
  intro: { gap: 12 },
  stepTitle: { letterSpacing: -0.34 },
  stepBody: { maxWidth: 300 },
  card: { padding: 22, gap: 18 },
  bankroll: {},
  currencyBlock: { gap: 9 },
  chipRow: { flexDirection: 'row', gap: 8 },
  leagueGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  riskList: { gap: 12 },
  riskCard: { padding: 17, gap: 6 },
  riskHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  actions: { marginTop: 'auto', gap: 10 },
  skip: { height: 44, alignItems: 'center', justifyContent: 'center' },
});
