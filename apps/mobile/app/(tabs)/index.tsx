/**
 * Hoy: partidos del día, el parlay recomendado y el acceso al builder.
 */

import { formatMoney, formatOdds, formatSignedPercent, isCurrencyCode } from '@wagerwise/core';
import { evaluateParlay, type ParlayLeg } from '@wagerwise/engine';
import { Chip, GlassCard, Overline, Pill, Rise, Txt, evTone, useTheme } from '@wagerwise/ui';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SampleDataBanner } from '@/components/SampleDataBanner';
import { bestParlay, type FixtureView, type MarketOffer } from '@/lib/fixtures';
import { useFixtureData } from '@/lib/queries';
import { useBuilder } from '@/state/builder';
import { usePreferences } from '@/state/preferences';

const ALL = 'Todas';

export default function TodayRoute(): React.ReactElement {
  const router = useRouter();
  const { theme } = useTheme();
  const [league, setLeague] = useState(ALL);

  const bankroll = usePreferences((s) => s.bankroll);
  const currencyRaw = usePreferences((s) => s.currency);
  const currency = isCurrencyCode(currencyRaw) ? currencyRaw : 'COP';
  const loadParlay = useBuilder((s) => s.loadParlay);

  const data = useFixtureData();

  // El encabezado no puede decir "hoy" si el próximo partido es dentro de tres
  // semanas: durante un parón sería sencillamente falso.
  const heading = useMemo(() => headingFor(visibleNext(data.fixtures)), [data.fixtures]);

  const visible = useMemo(
    () => data.fixtures.filter((f) => league === ALL || f.league === league),
    [data.fixtures, league],
  );

  // El parlay del día se evalúa con el motor, no con números precalculados: la
  // cuota y el EV que se ven son los que produce la misma lógica del builder.
  const daily = useMemo(() => {
    const picks = bestParlay(data.fixtures);
    const legs = picks.map(toLeg);
    return { picks, legs, evaluation: evaluateParlay(legs, data.matrices) };
  }, [data.fixtures, data.matrices]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[]}
      >
        <SampleDataBanner source={data.source} emptySchedule={data.emptySchedule} />

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Overline>
              {heading.overline} · {league === ALL ? 'todas las ligas' : league}
            </Overline>
            <Txt variant="display" style={styles.headerTitle}>
              {heading.title}
            </Txt>
          </View>
          <View style={styles.headerRight}>
            <Overline>Bankroll</Overline>
            <Txt variant="title" style={styles.bankroll}>
              {formatMoney(bankroll, currency)}
            </Txt>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipRow}>
            <Chip label={ALL} active={league === ALL} onPress={() => setLeague(ALL)} />
            {data.leagues.map((name) => (
              <Chip
                key={name}
                label={name}
                active={league === name}
                onPress={() => setLeague(name)}
              />
            ))}
          </View>
        </ScrollView>

        {/* ── Parlay del día ── */}
        {daily.picks.length > 0 ? (
        <GlassCard variant="hero" style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <View style={styles.heroBadgeRow}>
              <View style={[styles.aiDot, { backgroundColor: theme.colors.accent }]}>
                <Txt variant="pill" style={styles.aiDotText}>
                  AI
                </Txt>
              </View>
              <Txt variant="bodySmall" style={styles.heroTitle}>
                Parlay del día
              </Txt>
            </View>
            <Pill
              label={`EV ${formatSignedPercent(daily.evaluation.expectedValue)}`}
              tone={evTone(daily.evaluation.expectedValue * 100)}
            />
          </View>

          <View style={styles.legList}>
            {daily.picks.map(({ fixture, market }) => (
              <GlassCard key={market.id} variant="inner" style={styles.legRow}>
                <View style={styles.legInfo}>
                  <Txt variant="bodySmall" style={styles.legLabel} numberOfLines={1}>
                    {market.label}
                  </Txt>
                  <Txt variant="caption" tone="ink3" numberOfLines={1}>
                    {fixture.homeTeam} vs {fixture.awayTeam}
                  </Txt>
                </View>
                <Txt variant="odds" tone="accent">
                  {formatOdds(market.odds)}
                </Txt>
              </GlassCard>
            ))}
          </View>

          <View style={styles.heroFooter}>
            <View>
              <Overline>Cuota combinada</Overline>
              <Txt variant="heroSmall" style={styles.heroOdds}>
                {formatOdds(daily.evaluation.combinedOdds)}
              </Txt>
            </View>
            <Pressable
              onPress={() => {
                loadParlay(daily.legs);
                router.push('/(tabs)/builder');
              }}
              accessibilityRole="button"
              accessibilityLabel="Cargar el parlay del día al builder"
              style={({ pressed }) => [
                styles.loadButton,
                { backgroundColor: theme.colors.ink, opacity: pressed ? 0.86 : 1 },
              ]}
            >
              <Txt variant="bodySmall" style={[styles.loadLabel, { color: theme.colors.bg }]}>
                Cargar al builder
              </Txt>
            </Pressable>
          </View>
        </GlassCard>
        ) : (
          <GlassCard variant="card" style={styles.emptyCard}>
            <Txt variant="bodySmall">Hoy no hay ningún parlay con valor</Txt>
            <Txt variant="caption" tone="ink2">
              Ninguna casa paga por encima de lo que el mercado entero cree que vale cada
              resultado. Recomendar un parlay igualmente sería regalar el margen: mejor esperar.
            </Txt>
          </GlassCard>
        )}

        <Overline>
          {visible.length} {visible.length === 1 ? 'partido' : 'partidos'} · ordenados por EV
        </Overline>

        {visible.map((fixture, index) => (
          <Rise key={fixture.id} index={index}>
            <FixtureCard fixture={fixture} />
          </Rise>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function FixtureCard({ fixture }: { fixture: FixtureView }): React.ReactElement {
  const { theme } = useTheme();
  const router = useRouter();
  const evPercent = fixture.bestEv * 100;

  const split = fixture.split;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/match/[id]', params: { id: fixture.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${fixture.homeTeam} contra ${fixture.awayTeam}`}
    >
      <GlassCard variant="card" style={styles.fixtureCard}>
        <View style={styles.fixtureHeader}>
          <Txt variant="caption" tone="ink3" uppercase>
            {fixture.league} · {fixture.kickoff}
          </Txt>
          {/* Sin mercados no hay EV que enseñar. Un "+0,0%" daría a entender
              que se calculó y salió nulo, cuando lo que falta es la cuota. */}
          {fixture.markets.length > 0 ? (
            <Pill label={`EV ${formatSignedPercent(fixture.bestEv)}`} tone={evTone(evPercent)} />
          ) : (
            <Txt variant="caption" tone="ink3">
              sin cuotas aún
            </Txt>
          )}
        </View>

        <View style={styles.fixtureBody}>
          <View style={styles.teams}>
            <Txt variant="title" numberOfLines={1}>
              {fixture.homeTeam}
            </Txt>
            <Txt variant="title" tone="ink2" numberOfLines={1}>
              {fixture.awayTeam}
            </Txt>
          </View>

          <View style={styles.quickOdds}>
            {(['1', 'X', '2'] as const).map((key, index) => (
              <GlassCard key={key} variant="inner" radius={15} style={styles.quickOddsCell}>
                <Txt variant="caption" tone="ink3">
                  {key}
                </Txt>
                <Txt variant="bodySmall" style={styles.quickOddsValue}>
                  {fixture.matchOdds ? formatOdds(fixture.matchOdds[index]!) : '—'}
                </Txt>
              </GlassCard>
            ))}
          </View>
        </View>

        {/* Barra de probabilidad: local / empate / visitante. */}
        <View style={styles.modelRow}>
          <View style={[styles.modelBar, { backgroundColor: theme.colors.hair }]}>
            <View
              style={{ width: `${split.home * 100}%`, backgroundColor: theme.colors.accent }}
            />
            <View style={{ width: `${split.draw * 100}%`, backgroundColor: theme.colors.ink3 }} />
          </View>
          <Txt variant="caption" tone="ink3">
            {fixture.splitSource === 'estimate' ? 'prob.' : 'modelo'} {pct(split.home)}-
            {pct(split.draw)}-{pct(split.away)}
          </Txt>
        </View>
      </GlassCard>
    </Pressable>
  );
}

const pct = (n: number): string => String(Math.round(n * 100));

function visibleNext(fixtures: FixtureView[]): Date | null {
  const times = fixtures
    .map((f) => f.kickoffAt)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime());

  return times[0] ?? null;
}

/** "Hoy" sólo cuando de verdad hay algo hoy; si no, la fecha que toque. */
function headingFor(next: Date | null): { overline: string; title: string } {
  if (!next) return { overline: 'Hoy', title: 'Partidos de hoy' };

  const now = new Date();
  const sameDay = next.toDateString() === now.toDateString();
  if (sameDay) return { overline: 'Hoy', title: 'Partidos de hoy' };

  const label = next.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  return { overline: `Próxima jornada · ${label}`, title: 'Próximos partidos' };
}

function toLeg({
  fixture,
  market,
}: {
  fixture: FixtureView;
  market: MarketOffer;
}): ParlayLeg {
  return {
    id: market.id,
    fixtureId: fixture.id,
    selection: market.selection,
    odds: market.odds,
    probability: market.blendedProbability,
    label: market.label,
    matchLabel: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
  };
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingBottom: 24, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, paddingHorizontal: 4 },
  headerLeft: { flex: 1, gap: 7 },
  headerTitle: {},
  headerRight: { alignItems: 'flex-end', gap: 5 },
  bankroll: {},
  chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 4, paddingVertical: 2 },

  heroCard: { padding: 20, gap: 16 },
  emptyCard: { padding: 18, gap: 6 },
  heroHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  heroBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  aiDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  aiDotText: { color: '#FFFFFF' },
  heroTitle: { letterSpacing: 0.26 },
  legList: { gap: 9 },
  legRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 11, paddingHorizontal: 13 },
  legInfo: { flex: 1, gap: 3 },
  legLabel: {},
  heroFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  heroOdds: { marginTop: 6 },
  loadButton: { height: 46, paddingHorizontal: 20, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  loadLabel: {},

  fixtureCard: { padding: 16, paddingHorizontal: 17, gap: 13 },
  fixtureHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  fixtureBody: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teams: { flex: 1, gap: 2 },
  quickOdds: { flexDirection: 'row', gap: 6 },
  quickOddsCell: { width: 52, height: 50, alignItems: 'center', justifyContent: 'center', gap: 3 },
  quickOddsValue: {},
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  modelBar: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', flexDirection: 'row' },
});
