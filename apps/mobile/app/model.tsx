/**
 * Cómo le va al modelo: el backtesting, contado al usuario.
 *
 * Una app que dice encontrar valor le debe a quien la usa la prueba de que lo
 * encuentra. Esta pantalla enseña el resultado tal cual sale, también cuando no
 * favorece al producto: si el mercado predice mejor que el modelo, lo dice.
 */

import { formatPercent, formatSignedPercent, type Calibration, type BettingSimulationRow } from '@wagerwise/core';
import { Divider, GlassCard, Overline, Txt, useTheme } from '@wagerwise/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useAuth } from '@/lib/auth';
import { useCalibration } from '@/lib/calibration';
import { isBackendConfigured } from '@/lib/supabase';

const CURVE_HEIGHT = 72;

/** Umbral de ventaja que usa generate-parlays: la fila que de verdad importa. */
const PRODUCTION_EDGE = 0.02;

export default function ModelRoute(): React.ReactElement {
  const { theme } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const { data, isLoading, error } = useCalibration();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver al perfil"
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
            Perfil
          </Txt>
        </Pressable>

        <View style={styles.header}>
          <Overline>Backtesting{data ? ` · ${data.fixtures} partidos` : ''}</Overline>
          <Txt variant="display">Cómo le va al modelo</Txt>
        </View>

        {!isBackendConfigured ? (
          <Notice
            title="Sin backend"
            body="El backtesting corre en el servidor sobre partidos reales; sin backend configurado no hay nada que enseñar."
          />
        ) : !session ? (
          // Sin sesión, RLS devuelve cero filas y la pantalla diría que no hay
          // backtest cuando sí lo hay.
          <Notice
            title="Inicia sesión"
            body="El backtest se guarda en el servidor y sólo lo pueden leer las cuentas registradas."
          />
        ) : error ? (
          <Notice title="No se pudo cargar" body={(error as Error).message} />
        ) : isLoading ? (
          <Notice title="Cargando" body="Leyendo el último backtest." />
        ) : !data ? (
          <Notice
            title="Todavía no hay backtest"
            body="Se ejecuta cada lunes sobre los partidos ya jugados. En cuanto haya uno, aparecerá aquí."
          />
        ) : (
          <Report calibration={data} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Report({ calibration }: { calibration: Calibration }): React.ReactElement {
  const { metrics } = calibration;
  const weight = calibration.model_weight;
  const inUse = calibration.applied ? weight : metrics.defaultWeight;

  const previous = metrics.betting.default.find((row) => row.minEdge === PRODUCTION_EDGE);
  const current = metrics.betting.calibrated.find((row) => row.minEdge === PRODUCTION_EDGE);

  return (
    <>
      <GlassCard variant="hero" style={styles.hero}>
        <Overline>Peso del modelo en uso</Overline>
        <Txt variant="hero">{formatPercent(inUse, 0)}</Txt>
        <Txt variant="caption" tone="ink3">
          {calibration.applied
            ? `Antes ${formatPercent(metrics.defaultWeight, 0)}, elegido a ojo. Ahora es el peso que mejor predice ${calibration.events} mercados de ${calibration.fixtures} partidos ya jugados.`
            : `El backtest pide ${formatPercent(weight, 0)}, pero la muestra aún es corta y se sigue usando ${formatPercent(metrics.defaultWeight, 0)}.`}
        </Txt>
        <Divider />
        <Txt variant="bodySmall">{verdict(calibration)}</Txt>
      </GlassCard>

      <GlassCard variant="card" style={styles.card}>
        <Overline>Log loss según el peso del modelo</Overline>
        <CurveBars calibration={calibration} />
        <View style={styles.axis}>
          <Txt variant="caption" tone="ink3">
            0% · sólo mercado
          </Txt>
          <Txt variant="caption" tone="ink3">
            100% · sólo modelo
          </Txt>
        </View>
        <Txt variant="caption" tone="ink3">
          Más bajo es mejor. La log loss castiga sobre todo la confianza mal puesta: dar un 10% a
          lo que acabó pasando.
        </Txt>
      </GlassCard>

      <GlassCard variant="card" style={styles.card}>
        <Overline>Modelo, mercado y mezcla</Overline>
        <ScoreHeader />
        <ScoreRow label="1X2" comparison={metrics.byMarket.match_result} />
        <ScoreRow label="Más/menos 2.5" comparison={metrics.byMarket.total_goals_2_5} />
        <Divider />
        {metrics.byLeague.map((league) => (
          <ScoreRow key={league.leagueId} label={league.name} comparison={league} />
        ))}
        <Txt variant="caption" tone="ink3">
          Log loss media por mercado. El mercado es el consenso sin margen de las casas, con las
          cuotas publicadas días antes del partido.
        </Txt>
      </GlassCard>

      {previous ? (
        <GlassCard variant="card" style={styles.card}>
          <Overline>Si hubieras seguido las selecciones</Overline>
          <Simulation
            title={`Con el peso anterior (${formatPercent(metrics.defaultWeight, 0)})`}
            row={previous}
          />
          {current ? (
            <>
              <Divider />
              <Simulation title={`Con el peso calibrado (${formatPercent(weight, 0)})`} row={current} />
            </>
          ) : null}
          <Txt variant="caption" tone="ink3">
            Una unidad plana en cada selección con ventaja de al menos{' '}
            {formatPercent(PRODUCTION_EDGE, 0)}, a la mejor cuota previa. El margen es de dos
            errores estándar: un ROI que cabe en él es indistinguible de cero. Las cuotas de los
            exchanges ya descuentan su comisión.
          </Txt>
        </GlassCard>
      ) : null}

      <Txt variant="caption" tone="ink3" style={styles.legal}>
        Cada partido se predice sólo con lo jugado antes de ese día; el cierre se usa para medir,
        nunca para decidir. Cuotas de football-data.co.uk
        {calibration.window_from && calibration.window_to
          ? `, ${formatDay(calibration.window_from)} – ${formatDay(calibration.window_to)}`
          : ''}
        . Se recalcula cada lunes; último cálculo el {formatDay(calibration.created_at)}.
        {skippedNote(metrics.skipped)}
      </Txt>
    </>
  );
}

/** El titular, derivado de los números y no escrito a mano. */
function verdict(calibration: Calibration): string {
  const { metrics } = calibration;

  if (calibration.model_weight === 0 && !calibration.applied) {
    return (
      'Hasta ahora el mercado solo predice mejor que cualquier mezcla con el modelo, pero la ' +
      'muestra todavía es corta para cambiar nada por ello.'
    );
  }

  if (calibration.model_weight === 0) {
    return (
      'El mercado solo predice mejor que cualquier mezcla con el modelo. Mientras sea así, ' +
      'la app sólo marca valor cuando una casa paga por encima del consenso de las demás, ' +
      'no porque el modelo discrepe.'
    );
  }

  if (metrics.improvementOverMarket > 2 * metrics.standardError) {
    return (
      `El modelo aporta algo que el mercado no tenía: con un ${formatPercent(calibration.model_weight, 0)} ` +
      'de peso, la mezcla predice mejor que el mercado solo, y la mejora supera el ruido.'
    );
  }

  return (
    'El modelo mueve poco la aguja: la mezcla predice apenas mejor que el mercado solo, y ' +
    'la diferencia cabe dentro del ruido de la muestra.'
  );
}

function CurveBars({ calibration }: { calibration: Calibration }): React.ReactElement {
  const { theme } = useTheme();
  const curve = calibration.metrics.curve;
  const values = curve.map((point) => point.logLoss);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1e-9);

  return (
    <View
      style={styles.curve}
      accessibilityLabel={`Log loss mínima con un peso del modelo del ${formatPercent(calibration.model_weight, 0)}`}
    >
      {curve.map((point) => {
        const chosen = Math.abs(point.weight - calibration.model_weight) < 1e-9;
        // La escala arranca en el mínimo, no en cero: las diferencias son de
        // milésimas y una escala desde cero las dejaría todas iguales. Por eso
        // cada barra conserva una altura base.
        const height = 6 + ((point.logLoss - min) / span) * (CURVE_HEIGHT - 6);
        return (
          <View key={point.weight} style={styles.curveColumn}>
            <View
              style={[
                styles.curveBar,
                {
                  height,
                  backgroundColor: chosen ? theme.colors.accent : theme.colors.stroke,
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

function ScoreHeader(): React.ReactElement {
  return (
    <View style={styles.scoreRow}>
      <Txt variant="caption" tone="ink3" style={styles.scoreLabel}>
        {' '}
      </Txt>
      {['Modelo', 'Mercado', 'En uso'].map((title) => (
        <Txt key={title} variant="caption" tone="ink3" style={styles.scoreCell}>
          {title}
        </Txt>
      ))}
    </View>
  );
}

function ScoreRow({
  label,
  comparison,
}: {
  label: string;
  comparison: Calibration['metrics']['byMarket']['match_result'];
}): React.ReactElement {
  const values = [comparison.model.logLoss, comparison.market.logLoss, comparison.blend.logLoss];
  const best = Math.min(...values);

  return (
    <View style={styles.scoreRow}>
      <Txt variant="bodySmall" numberOfLines={1} style={styles.scoreLabel}>
        {label}
      </Txt>
      {values.map((value, index) => (
        <Txt
          key={index}
          variant="bodySmall"
          tone={value === best ? 'good' : 'ink2'}
          style={styles.scoreCell}
        >
          {value.toFixed(3)}
        </Txt>
      ))}
    </View>
  );
}

function Simulation({ title, row }: { title: string; row: BettingSimulationRow }): React.ReactElement {
  if (row.bets === 0) {
    return (
      <View style={styles.simulation}>
        <Txt variant="bodySmall">{title}</Txt>
        <Txt variant="caption" tone="ink3">
          Ninguna selección habría pasado el filtro de ventaja.
        </Txt>
      </View>
    );
  }

  const margin = 2 * row.standardError;
  const significant = Math.abs(row.roi) > margin;

  return (
    <View style={styles.simulation}>
      <Txt variant="bodySmall">{title}</Txt>
      <Txt variant="title" tone={significant ? (row.roi > 0 ? 'good' : 'bad') : 'ink'}>
        ROI {formatSignedPercent(row.roi)} ± {formatPercent(margin)}
      </Txt>
      <Txt variant="caption" tone="ink3">
        {row.bets} {row.bets === 1 ? 'apuesta' : 'apuestas'} · acierto {formatPercent(row.hitRate, 0)}
        {row.averageClv !== null
          ? ` · CLV ${formatSignedPercent(row.averageClv)} · batió el cierre en ${formatPercent(row.clvBeatRate ?? 0, 0)}`
          : ''}
      </Txt>
      {row.bets < 30 ? (
        <Txt variant="caption" tone="warn">
          Muy pocas apuestas para sacar conclusiones.
        </Txt>
      ) : null}
    </View>
  );
}

function Notice({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <GlassCard variant="card" style={styles.card}>
      <Txt variant="bodySmall">{title}</Txt>
      <Txt variant="caption" tone="ink2">
        {body}
      </Txt>
    </GlassCard>
  );
}

function skippedNote(skipped: Record<string, number>): string {
  const total = Object.values(skipped).reduce((a, b) => a + b, 0);
  if (total === 0) return '';
  return ` ${total} partidos quedaron fuera por falta de histórico previo (inicio de temporada o recién ascendidos).`;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingBottom: 30, gap: 15 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 44 },
  header: { gap: 6, marginBottom: 4 },

  hero: { padding: 22, gap: 12 },
  card: { padding: 17, gap: 12 },

  curve: { flexDirection: 'row', alignItems: 'flex-end', height: CURVE_HEIGHT, gap: 3 },
  curveColumn: { flex: 1, justifyContent: 'flex-end' },
  curveBar: { borderRadius: 3 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },

  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreLabel: { flex: 2 },
  scoreCell: { flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },

  simulation: { gap: 4 },
  legal: { textAlign: 'center', paddingHorizontal: 10, marginTop: 4 },
});
