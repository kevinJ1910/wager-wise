/**
 * Valor: las selecciones donde una casa paga más de lo que vale el resultado.
 *
 * Una apuesta aparece aquí cuando la probabilidad calibrada —hoy, el consenso
 * sin margen de todas las casas, porque el backtesting dio w = 0— supera a la
 * que implica la mejor cuota disponible. Es la misma
 * cuenta que hace el builder —nada se precalcula ni se guarda— así que el EV
 * de esta lista y el del parlay que construyas no pueden discrepar.
 *
 * La lista puede quedarse vacía, y eso es una respuesta válida: sin valor, la
 * recomendación correcta es no apostar.
 */

import { formatOdds, formatPercent, formatSignedPercent } from '@wagerwise/core';
import type { ParlayLeg } from '@wagerwise/engine';
import { Chip, GlassCard, Overline, Pill, Rise, Txt, evTone, useTheme } from '@wagerwise/ui';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SampleDataBanner } from '@/components/SampleDataBanner';
import type { FixtureView, MarketOffer } from '@/lib/fixtures';
import { useFixtureData } from '@/lib/queries';
import { useBuilder } from '@/state/builder';

/**
 * Umbrales de EV.
 *
 * El primero no es 0 sino 1%: por debajo de eso la ventaja cabe dentro del
 * error del propio modelo, y presentarla como valor sería fingir una precisión
 * que no tenemos.
 */
const FILTERS = [
  { id: 'all', label: 'Todo el valor', min: 0.01 },
  { id: 'good', label: 'EV > 3%', min: 0.03 },
  { id: 'strong', label: 'EV > 5%', min: 0.05 },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

interface ValueBet {
  fixture: FixtureView;
  market: MarketOffer;
}

export default function AlertsRoute(): React.ReactElement {
  const data = useFixtureData();
  const [filter, setFilter] = useState<FilterId>('all');

  const legs = useBuilder((s) => s.legs);
  const toggleLeg = useBuilder((s) => s.toggleLeg);
  const selectedIds = useMemo(() => new Set(legs.map((l) => l.id)), [legs]);

  const bets = useMemo<ValueBet[]>(() => {
    const min = FILTERS.find((f) => f.id === filter)?.min ?? 0.01;
    return data.fixtures
      .flatMap((fixture) => fixture.markets.map((market) => ({ fixture, market })))
      .filter(({ market }) => market.expectedValue >= min)
      .sort((a, b) => b.market.expectedValue - a.market.expectedValue);
  }, [data.fixtures, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <SampleDataBanner source={data.source} emptySchedule={data.emptySchedule} />

        <View style={styles.header}>
          <Overline>Valor · mejor precio contra consenso</Overline>
          <Txt variant="display">Dónde pagan de más</Txt>
          <Txt variant="caption" tone="ink2">
            Cada fila compara la mejor cuota disponible con la probabilidad que el conjunto de las
            casas, sin su margen, da a ese resultado. Toca la cuota para llevarla al builder.
          </Txt>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipRow}>
            {FILTERS.map((entry) => (
              <Chip
                key={entry.id}
                label={entry.label}
                active={filter === entry.id}
                onPress={() => setFilter(entry.id)}
              />
            ))}
          </View>
        </ScrollView>

        {bets.length === 0 ? (
          <GlassCard variant="card" style={styles.emptyCard}>
            <Txt variant="bodySmall">Ninguna selección supera el umbral</Txt>
            <Txt variant="caption" tone="ink2">
              El mercado está bien ajustado ahora mismo. No encontrar valor es un resultado del
              análisis, no un fallo: apostar sin ventaja es pagar el margen de la casa.
            </Txt>
          </GlassCard>
        ) : (
          <>
            <Overline>
              {bets.length} {bets.length === 1 ? 'selección' : 'selecciones'} · ordenadas por EV
            </Overline>

            {bets.map((bet, index) => (
              <Rise key={bet.market.id} index={index}>
                <ValueRow
                  bet={bet}
                  selected={selectedIds.has(bet.market.id)}
                  onToggle={() => toggleLeg(toLeg(bet))}
                />
              </Rise>
            ))}
          </>
        )}

        {legs.length >= 2 ? <BuilderLink count={legs.length} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ValueRow({
  bet,
  selected,
  onToggle,
}: {
  bet: ValueBet;
  selected: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const { theme } = useTheme();
  const router = useRouter();
  const { fixture, market } = bet;

  return (
    <GlassCard variant="card" selected={selected} style={styles.betCard}>
      <Pressable
        onPress={() => router.push({ pathname: '/match/[id]', params: { id: fixture.id } })}
        accessibilityRole="button"
        accessibilityLabel={`Ver ${fixture.homeTeam} contra ${fixture.awayTeam}`}
        style={styles.betInfo}
      >
        <View style={styles.betHeader}>
          <Txt variant="caption" tone="ink3" uppercase numberOfLines={1}>
            {fixture.league} · {fixture.kickoff}
          </Txt>
          <Pill
            label={`EV ${formatSignedPercent(market.expectedValue)}`}
            tone={evTone(market.expectedValue * 100)}
          />
        </View>

        <Txt variant="bodySmall" numberOfLines={1}>
          {market.label}
        </Txt>
        <Txt variant="caption" tone="ink2" numberOfLines={1}>
          {fixture.homeTeam} vs {fixture.awayTeam}
        </Txt>

        {/* La ventaja es la diferencia que justifica la apuesta: sin ella, el
            EV positivo sería sólo ruido de redondeo. */}
        <Txt variant="caption" tone="ink3" numberOfLines={1}>
          prob. {formatPercent(market.blendedProbability, 0)} · la cuota implica{' '}
          {formatPercent(1 / market.odds, 0)} · ventaja {formatSignedPercent(market.edge)}
          {market.bookmaker ? ` · ${market.bookmaker}` : ''}
        </Txt>
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

function BuilderLink({ count }: { count: number }): React.ReactElement {
  const { theme } = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push('/(tabs)/builder')}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.goBuilder,
        { backgroundColor: theme.colors.ink, opacity: pressed ? 0.86 : 1 },
      ]}
    >
      <Txt variant="button" style={{ color: theme.colors.bg }}>
        Auditar parlay ({count})
      </Txt>
    </Pressable>
  );
}

function toLeg({ fixture, market }: ValueBet): ParlayLeg {
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
  scroll: { paddingHorizontal: 18, paddingBottom: 28, gap: 15 },
  header: { gap: 7, paddingHorizontal: 4 },
  chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 4, paddingVertical: 2 },

  emptyCard: { padding: 18, gap: 6 },
  betCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, paddingLeft: 17 },
  betInfo: { flex: 1, gap: 5 },
  betHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
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
