/**
 * Builder: el parlay en construcción y su auditoría.
 *
 * Ningún número de esta pantalla está almacenado. Todo se deriva en cada render
 * desde las legs con `@wagerwise/engine`, así que la cuota, la probabilidad
 * conjunta, el EV y los avisos no pueden quedar desincronizados entre sí.
 */

import Slider from '@react-native-community/slider';
import { formatMoney, formatOdds, formatPercent, formatSignedPercent, isCurrencyCode } from '@wagerwise/core';
import { RISK_PROFILES, auditParlay, evaluateParlay, type AuditCheck } from '@wagerwise/engine';
import { Button, GlassCard, Overline, Pill, Txt, useTheme } from '@wagerwise/ui';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { usePlaceParlay } from '@/lib/bets';
import { useFixtureData } from '@/lib/queries';
import { markPlaced, useBuilder } from '@/state/builder';
import { usePreferences } from '@/state/preferences';

export default function BuilderRoute(): React.ReactElement {
  const { theme } = useTheme();
  const router = useRouter();

  const legs = useBuilder((s) => s.legs);
  const stakePct = useBuilder((s) => s.stakePct);
  const placed = useBuilder((s) => s.placed);
  const setStakePct = useBuilder((s) => s.setStakePct);
  const removeLeg = useBuilder((s) => s.removeLeg);
  const removeLegs = useBuilder((s) => s.removeLegs);
  const clearBuilder = useBuilder((s) => s.clear);

  const bankroll = usePreferences((s) => s.bankroll);
  const currencyRaw = usePreferences((s) => s.currency);
  const currency = isCurrencyCode(currencyRaw) ? currencyRaw : 'COP';
  const riskProfileId = usePreferences((s) => s.riskProfile);
  const settings = usePreferences((s) => s.settings);
  const profile = RISK_PROFILES[riskProfileId];

  const stake = (bankroll * stakePct) / 100;
  const place = usePlaceParlay();

  // Las matrices vienen de la misma fuente que las pantallas de selección: sin
  // la del partido, la conjunta exacta no se puede calcular y el auditor
  // perdería justo lo que lo distingue.
  const { matrices } = useFixtureData();
  const evaluation = useMemo(() => evaluateParlay(legs, matrices), [legs, matrices]);
  const audit = useMemo(
    () => auditParlay({ legs, evaluation, profile, bankroll, stakeAmount: stake, settings }),
    [legs, evaluation, profile, bankroll, stake, settings],
  );

  const correlatedLegIds = new Set(evaluation.correlatedGroups.flatMap((g) => g.legIds));
  const hasLegs = legs.length > 0;

  /**
   * Registrar no cursa nada: deja constancia de lo que el usuario apostó en su
   * casa de apuestas, para poder medirlo después. El parlay se guarda con la
   * probabilidad y el EV que el auditor calculó en este momento, no con los de
   * cuando se liquide: eso es lo que permite comprobar si el modelo acertaba.
   */
  function register(): void {
    if (place.isPending || placed) return;

    place.mutate(
      {
        legs,
        stake,
        currency,
        combinedOdds: evaluation.combinedOdds,
        trueProbability: evaluation.trueProbability,
        expectedValue: evaluation.expectedValue,
      },
      { onSuccess: () => markPlaced() },
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Overline>Constructor · parlay builder</Overline>
          <Txt variant="display" style={styles.title}>
            {hasLegs
              ? `${legs.length} ${legs.length === 1 ? 'leg seleccionada' : 'legs seleccionadas'}`
              : 'Parlay vacío'}
          </Txt>
        </View>

        {/* ── Resumen ── */}
        <GlassCard variant="hero" style={styles.summary}>
          <View style={styles.summaryTop}>
            <View>
              <Overline>Cuota total</Overline>
              <Txt variant="hero" style={styles.totalOdds}>
                {hasLegs ? formatOdds(evaluation.combinedOdds) : '—'}
              </Txt>
            </View>
            {hasLegs ? (
              <Pill
                label={`EV ${formatSignedPercent(evaluation.expectedValue)}`}
                tone={evaluation.expectedValue >= 0 ? 'good' : 'bad'}
              />
            ) : null}
          </View>

          <View style={styles.probRow}>
            <GlassCard variant="inner" style={styles.probCell}>
              <Overline>Prob. implícita</Overline>
              <Txt variant="title" style={styles.probValue}>
                {hasLegs ? formatPercent(evaluation.impliedProbability) : '—'}
              </Txt>
            </GlassCard>
            <GlassCard variant="inner" style={styles.probCell}>
              <Overline>Prob. modelo</Overline>
              <Txt variant="title" tone="accent" style={styles.probValue}>
                {hasLegs ? formatPercent(evaluation.trueProbability) : '—'}
              </Txt>
            </GlassCard>
          </View>

          {/*
            Cuando hay correlación, enseñamos explícitamente en qué se diferencia
            del cálculo ingenuo. Es la prueba visible de que el auditor corrige
            el número en vez de sólo advertir.
          */}
          {evaluation.correlatedGroups.length > 0 ? (
            <Txt variant="caption" tone="ink3">
              Multiplicar cuotas daría {formatPercent(evaluation.naiveProbability)} y un EV de{' '}
              {formatSignedPercent(evaluation.naiveExpectedValue)}. Mostramos la conjunta real.
            </Txt>
          ) : null}
        </GlassCard>

        {/* ── Auditor ── */}
        <AuditPanel
          checks={audit.checks}
          clean={audit.clean}
          warningCount={audit.warningCount}
          negativeEv={evaluation.expectedValue < 0}
          fix={audit.fix}
          onApplyFix={(ids) => removeLegs(ids)}
        />

        {/* ── Legs ── */}
        {legs.map((leg) => (
          <GlassCard key={leg.id} variant="card" style={styles.legCard}>
            <View style={styles.legInfo}>
              <Txt variant="bodySmall" style={styles.legTitle}>
                {leg.label ?? 'Selección'}
              </Txt>
              <Txt variant="caption" tone="ink3">
                {leg.matchLabel ?? ''}
              </Txt>
              {correlatedLegIds.has(leg.id) ? (
                <Txt variant="caption" tone="warn" style={styles.legFlag}>
                  Correlacionada con otra leg del mismo partido
                </Txt>
              ) : null}
            </View>

            <Txt variant="odds" tone="accent">
              {formatOdds(leg.odds)}
            </Txt>

            <Pressable
              onPress={() => removeLeg(leg.id)}
              accessibilityRole="button"
              accessibilityLabel={`Quitar ${leg.label ?? 'selección'}`}
              style={styles.removeButton}
            >
              <Svg width={15} height={15} viewBox="0 0 15 15" fill="none">
                <Path
                  d="M3.5 3.5l8 8M11.5 3.5l-8 8"
                  stroke={theme.colors.ink3}
                  strokeWidth={1.7}
                  strokeLinecap="round"
                />
              </Svg>
            </Pressable>
          </GlassCard>
        ))}

        {!hasLegs ? (
          <GlassCard variant="card" style={styles.empty}>
            <Txt variant="bodySmall" tone="ink2" style={styles.emptyText}>
              Añade selecciones desde un partido o desde las alertas de valor. El auditor revisará
              correlación, varianza, EV y stake antes de que registres nada.
            </Txt>
          </GlassCard>
        ) : null}

        {/* ── Stake ── */}
        <GlassCard variant="card" style={styles.stakeCard}>
          <View style={styles.stakeHeader}>
            <Overline>Stake · Kelly 1/{Math.round(1 / profile.kellyFraction)}</Overline>
            <Txt variant="title">{formatMoney(stake, currency)}</Txt>
          </View>

          <Slider
            minimumValue={1}
            maximumValue={12}
            step={1}
            value={stakePct}
            onValueChange={setStakePct}
            minimumTrackTintColor={theme.colors.accent}
            maximumTrackTintColor={theme.colors.hair}
            thumbTintColor={theme.colors.accent}
            accessibilityLabel="Porcentaje del bankroll"
          />

          <View style={styles.stakeFooter}>
            <Txt variant="caption" tone="ink3">
              {stakePct}% del bankroll
            </Txt>
            <Txt variant="caption" tone="ink3">
              Retorno {hasLegs ? formatMoney(stake * evaluation.combinedOdds, currency) : '—'}
            </Txt>
          </View>

          <Button
            label={
              placed
                ? 'Apuesta registrada ✓'
                : place.isPending
                  ? 'Registrando…'
                  : legs.length < 2
                    ? 'Añade otra leg'
                    : `Registrar ${formatMoney(stake, currency)}`
            }
            onPress={register}
            disabled={legs.length < 2 || placed || place.isPending}
            style={styles.placeButton}
          />

          {place.error ? (
            <Txt variant="caption" tone="bad" style={styles.placeNote}>
              {(place.error as Error).message}
            </Txt>
          ) : placed ? (
            <Txt variant="caption" tone="ink3" style={styles.placeNote}>
              Guardada en tu historial. WagerWise no cursa la apuesta: tienes que hacerla en tu
              casa de apuestas.
            </Txt>
          ) : null}
        </GlassCard>

        {placed ? (
          <View style={styles.afterPlace}>
            <Button label="Ver en Apuestas" variant="glass" onPress={() => router.push('/(tabs)/bets')} />
            <Button label="Empezar otro parlay" variant="glass" onPress={clearBuilder} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function AuditPanel({
  checks,
  clean,
  warningCount,
  negativeEv,
  fix,
  onApplyFix,
}: {
  checks: AuditCheck[];
  clean: boolean;
  warningCount: number;
  negativeEv: boolean;
  fix?: { label: string; removeLegIds: string[] };
  onApplyFix: (ids: string[]) => void;
}): React.ReactElement | null {
  const { theme } = useTheme();
  if (checks.length === 0) return null;

  // El fondo del panel sigue la severidad, como en el diseño.
  const tint = clean
    ? theme.colors.goodSoft
    : negativeEv
      ? theme.colors.badSoft
      : theme.colors.warnSoft;
  const accentColor = clean ? theme.colors.good : negativeEv ? theme.colors.bad : theme.colors.warn;

  const dotColor = (severity: AuditCheck['severity']): string =>
    severity === 'ok' ? theme.colors.good : severity === 'bad' ? theme.colors.bad : theme.colors.warn;

  return (
    <GlassCard variant="card" tint={tint} style={styles.audit}>
      <View style={styles.auditHeader}>
        <View style={[styles.auditIcon, { backgroundColor: accentColor }]}>
          <Txt variant="pill" style={[styles.auditIconText, { color: theme.colors.bg }]}>
            {clean ? '✓' : '!'}
          </Txt>
        </View>
        <Txt variant="bodySmall" style={styles.auditTitle}>
          {clean
            ? 'Parlay limpio · sin errores detectados'
            : `${warningCount} aviso${warningCount > 1 ? 's' : ''} antes de apostar`}
        </Txt>
      </View>

      <View style={styles.checkList}>
        {checks.map((check) => (
          <View key={check.id} style={styles.checkRow}>
            <View style={[styles.checkDot, { backgroundColor: dotColor(check.severity) }]} />
            <View style={styles.checkBody}>
              <Txt variant="bodySmall" style={styles.checkTitle}>
                {check.title}
              </Txt>
              <Txt variant="caption" tone="ink2">
                {check.body}
              </Txt>
            </View>
          </View>
        ))}
      </View>

      {fix ? (
        <Button
          label={fix.label}
          variant="glass"
          onPress={() => onApplyFix(fix.removeLegIds)}
          style={styles.fixButton}
        />
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingBottom: 24, gap: 15 },
  header: { paddingHorizontal: 4, gap: 7 },
  title: {},

  summary: { padding: 22, gap: 20 },
  summaryTop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  totalOdds: { marginTop: 8 },
  probRow: { flexDirection: 'row', gap: 10 },
  probCell: { flex: 1, padding: 13, gap: 7 },
  probValue: {},

  audit: { padding: 18, gap: 13 },
  auditHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  auditIcon: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  auditIconText: {},
  auditTitle: {},
  checkList: { gap: 9 },
  checkRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  checkDot: { width: 9, height: 9, borderRadius: 4.5, marginTop: 5 },
  checkBody: { flex: 1, gap: 3 },
  checkTitle: {},
  fixButton: { marginTop: 2 },

  legCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, paddingHorizontal: 16 },
  legInfo: { flex: 1, gap: 4 },
  legTitle: {},
  legFlag: { marginTop: 2 },
  removeButton: { width: 34, height: 44, alignItems: 'center', justifyContent: 'center' },

  empty: { padding: 20 },
  emptyText: {},

  stakeCard: { padding: 19, gap: 6 },
  stakeHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  stakeFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  placeButton: { marginTop: 14 },
  placeNote: { marginTop: 9 },
  afterPlace: { gap: 10 },
});
