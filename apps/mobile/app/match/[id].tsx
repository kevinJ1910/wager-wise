/**
 * Detalle de partido: probabilidades, mercados y el acceso al builder.
 *
 * Tocar dos mercados del mismo partido es exactamente el caso que el auditor
 * corrige, así que desde aquí se puede comprobar el comportamiento de verdad.
 */

import { formatOdds, formatPercent, formatSignedPercent } from '@wagerwise/core';
import { matchResultProbabilities, type ParlayLeg } from '@wagerwise/engine';
import { GlassCard, Overline, Pill, Txt, evTone, useTheme } from '@wagerwise/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import type { FixtureAnalysis, FixtureView, MarketOffer } from '@/lib/fixtures';
import { useFixtureAnalyses, useFixtureData } from '@/lib/queries';
import { useBuilder } from '@/state/builder';

export default function MatchRoute(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { theme } = useTheme();

  const data = useFixtureData();
  const fixture = data.fixtures.find((f) => f.id === id);
  const analyses = useFixtureAnalyses(fixture?.id);

  const legs = useBuilder((s) => s.legs);
  const toggleLeg = useBuilder((s) => s.toggleLeg);

  const probabilities = useMemo(
    () => (fixture ? matchResultProbabilities(fixture.matrix) : null),
    [fixture],
  );

  if (!fixture || !probabilities) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.missing}>
          <Txt variant="body" tone="ink2">
            No encontramos ese partido.
          </Txt>
        </View>
      </SafeAreaView>
    );
  }

  const selectedIds = new Set(legs.map((l) => l.id));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver a partidos"
          style={styles.back}
        >
          <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
            <Path
              d="M10 3L5 8l5 5"
              stroke={theme.colors.ink2}
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Txt variant="bodySmall" tone="ink2">
            Partidos
          </Txt>
        </Pressable>

        <GlassCard variant="hero" style={styles.heroCard}>
          <Txt variant="caption" tone="ink3" uppercase>
            {fixture.league} · {fixture.kickoff}
          </Txt>
          <Txt variant="display" style={styles.matchup}>
            {fixture.homeTeam}
            {'\n'}vs {fixture.awayTeam}
          </Txt>

          <View style={styles.probRow}>
            {(
              [
                { key: 'Local', value: probabilities.home, odds: fixture.matchOdds?.[0] },
                { key: 'Empate', value: probabilities.draw, odds: fixture.matchOdds?.[1] },
                { key: 'Visita', value: probabilities.away, odds: fixture.matchOdds?.[2] },
              ] as const
            ).map((entry) => (
              <GlassCard key={entry.key} variant="inner" radius={18} style={styles.probCell}>
                <Txt variant="caption" tone="ink3" uppercase>
                  {entry.key}
                </Txt>
                <Txt variant="title" style={styles.probValue}>
                  {formatPercent(entry.value, 0)}
                </Txt>
                <Txt variant="caption" tone="ink3">
                  {entry.odds ? `cuota ${formatOdds(entry.odds)}` : 'sin cuota'}
                </Txt>
              </GlassCard>
            ))}
          </View>
        </GlassCard>

        <GlassCard variant="card" style={styles.ratesCard}>
          <Overline>Tasas del modelo</Overline>
          <View style={styles.ratesRow}>
            <View style={styles.rateCell}>
              <Txt variant="caption" tone="ink3">
                Goles esperados local
              </Txt>
              <Txt variant="title">{fixture.lambda.toFixed(2)}</Txt>
            </View>
            <View style={styles.rateCell}>
              <Txt variant="caption" tone="ink3">
                Goles esperados visita
              </Txt>
              <Txt variant="title">{fixture.mu.toFixed(2)}</Txt>
            </View>
          </View>
          <Txt variant="caption" tone="ink2">
            Toda probabilidad de esta pantalla sale de la matriz de marcadores que generan estas dos
            tasas, no de una tabla aparte.
          </Txt>
        </GlassCard>

        {(analyses.data ?? []).length > 0 ? (
          <>
            <Overline>Análisis · Gemini</Overline>
            {(analyses.data ?? []).map((analysis) => (
              <AnalysisCard key={analysis.id} analysis={analysis} />
            ))}
          </>
        ) : null}

        <Overline>Mercados · toca para añadir</Overline>

        {fixture.markets.map((market) => (
          <MarketRow
            key={market.id}
            fixture={fixture}
            market={market}
            selected={selectedIds.has(market.id)}
            onToggle={() => toggleLeg(toLeg(fixture, market))}
          />
        ))}

        {legs.length >= 2 ? (
          <Pressable
            onPress={() => router.push('/(tabs)/builder')}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.goBuilder,
              { backgroundColor: theme.colors.ink, opacity: pressed ? 0.86 : 1 },
            ]}
          >
            <Txt variant="button" style={{ color: theme.colors.bg }}>
              Ver parlay ({legs.length})
            </Txt>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Lo que aporta la IA, separado de lo que calcula el motor.
 *
 * Gemini nunca produce probabilidades: recibe las del motor y devuelve
 * contexto. La confianza que muestra es sobre ese contexto —cuánta información
 * verificable encontró—, no sobre que la apuesta vaya a acertar, y por eso se
 * etiqueta así en pantalla.
 */
function AnalysisCard({ analysis }: { analysis: FixtureAnalysis }): React.ReactElement {
  return (
    <GlassCard variant="card" style={styles.analysisCard}>
      <View style={styles.analysisHeader}>
        <Txt variant="caption" tone="ink3" uppercase>
          {analysis.model}
        </Txt>
        {analysis.confidence !== null ? (
          <Txt variant="caption" tone="ink3">
            contexto {analysis.confidence}/100
          </Txt>
        ) : null}
      </View>

      <Txt variant="bodySmall">{analysis.reasoning}</Txt>

      {analysis.facts.length > 0 ? (
        <View style={styles.factRow}>
          {analysis.facts.map((fact) => (
            <GlassCard key={`${fact.label}:${fact.value}`} variant="inner" radius={13} style={styles.factChip}>
              <Txt variant="caption" tone="ink3">
                {fact.label}
              </Txt>
              <Txt variant="caption">{fact.value}</Txt>
            </GlassCard>
          ))}
        </View>
      ) : null}

      {analysis.veto ? (
        <Txt variant="caption" tone="warn">
          Veto: {analysis.vetoReason ?? 'la IA desaconseja esta selección.'}
        </Txt>
      ) : null}
    </GlassCard>
  );
}

function MarketRow({
  fixture,
  market,
  selected,
  onToggle,
}: {
  fixture: FixtureView;
  market: MarketOffer;
  selected: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const { theme } = useTheme();

  return (
    <GlassCard variant="card" selected={selected} style={styles.marketCard}>
      <Pressable onPress={onToggle} style={styles.marketInfo} accessibilityRole="button">
        <Txt variant="bodySmall" style={styles.marketName}>
          {market.label}
        </Txt>
        <View style={styles.marketMeta}>
          <Txt variant="caption" tone="ink3">
            prob. modelo {formatPercent(market.modelProbability, 0)}
          </Txt>
          <Pill
            label={formatSignedPercent(market.expectedValue)}
            tone={evTone(market.expectedValue * 100)}
          />
        </View>
      </Pressable>

      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${selected ? 'Quitar' : 'Añadir'} ${market.label} a cuota ${formatOdds(market.odds)}`}
        style={[
          styles.oddsButton,
          {
            backgroundColor: selected ? theme.colors.accent : theme.colors.glass2,
            borderColor: selected ? theme.colors.accent : theme.colors.hair,
          },
        ]}
      >
        <Txt variant="odds" style={{ color: selected ? '#FFFFFF' : theme.colors.ink }}>
          {formatOdds(market.odds)}
        </Txt>
      </Pressable>
    </GlassCard>
  );
}

function toLeg(fixture: FixtureView, market: MarketOffer): ParlayLeg {
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
  scroll: { paddingHorizontal: 18, paddingBottom: 30, gap: 15 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 44 },

  heroCard: { padding: 22, gap: 12 },
  matchup: { lineHeight: 36 },
  probRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  probCell: { flex: 1, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', gap: 5 },
  probValue: {},

  ratesCard: { padding: 17, gap: 12 },
  analysisCard: { padding: 17, gap: 10 },
  analysisHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  factChip: { paddingVertical: 7, paddingHorizontal: 11, gap: 2 },
  ratesRow: { flexDirection: 'row', gap: 16 },
  rateCell: { flex: 1, gap: 4 },

  marketCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, paddingLeft: 17 },
  marketInfo: { flex: 1, gap: 6 },
  marketName: {},
  marketMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  oddsButton: {
    minWidth: 64,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },

  goBuilder: { height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
});
