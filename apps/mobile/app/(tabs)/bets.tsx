/**
 * Apuestas: P/L, acierto, ROI, CLV e historial.
 *
 * Todos los números salen de `summarizeBets`, en el motor, sobre las filas tal
 * como las dejó la liquidación del backend. La pantalla no decide nada: si algo
 * aparece como ganado es porque el marcador real lo dice.
 */

import { formatMoney, formatOdds, formatPercent, formatSignedPercent, isCurrencyCode } from '@wagerwise/core';
import type { BetStats, BetStatus } from '@wagerwise/engine';
import { Divider, GlassCard, Overline, Rise, Txt, useTheme } from '@wagerwise/ui';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBets, type BetView } from '@/lib/bets';
import { useAuth } from '@/lib/auth';
import { isBackendConfigured } from '@/lib/supabase';
import { usePreferences } from '@/state/preferences';

/** Barras de la sparkline. El diseño usa doce. */
const SPARK_BARS = 12;
const SPARK_HEIGHT = 56;

export default function BetsRoute(): React.ReactElement {
  const { theme } = useTheme();
  const { session } = useAuth();
  const { bets, stats, isLoading, error } = useBets();

  const currencyRaw = usePreferences((s) => s.currency);
  const fallbackCurrency = isCurrencyCode(currencyRaw) ? currencyRaw : 'COP';
  // El historial manda: una apuesta registrada en euros se sigue mostrando en
  // euros aunque el usuario haya cambiado de moneda después.
  const currency = firstCurrency(bets) ?? fallbackCurrency;

  const profitTone = stats.profit > 0 ? 'good' : stats.profit < 0 ? 'bad' : 'ink';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Overline>Historial · apuestas registradas</Overline>
          <Txt variant="display">Mis apuestas</Txt>
        </View>

        <GlassCard variant="hero" style={styles.hero}>
          <View style={styles.heroTop}>
            <View>
              <Overline>Profit / loss</Overline>
              <Txt variant="hero" tone={profitTone} style={styles.profit}>
                {stats.settled === 0 ? '—' : signedMoney(stats.profit, currency)}
              </Txt>
            </View>
            <Sparkline curve={stats.curve} />
          </View>

          <View style={styles.statRow}>
            <Stat
              label="Acierto"
              value={stats.won + stats.lost === 0 ? '—' : formatPercent(stats.hitRate, 0)}
            />
            <Stat
              label="ROI"
              value={stats.staked === 0 ? '—' : formatSignedPercent(stats.roi)}
            />
            <Stat label="Apuestas" value={String(stats.settled + stats.open)} />
          </View>

          <ClvLine stats={stats} />

          {stats.open > 0 ? (
            <Txt variant="caption" tone="ink3">
              {stats.open} {stats.open === 1 ? 'apuesta abierta' : 'apuestas abiertas'} ·{' '}
              {formatMoney(stats.openStake, currency)} en juego
            </Txt>
          ) : null}
        </GlassCard>

        {!isBackendConfigured || !session ? (
          <Notice
            title="Historial no disponible"
            body="El seguimiento necesita sesión y backend: las apuestas se guardan en tu cuenta, no en el dispositivo."
          />
        ) : error ? (
          <Notice title="No se pudo cargar el historial" body={error.message} />
        ) : isLoading ? (
          <Notice title="Cargando" body="Leyendo tus apuestas registradas." />
        ) : bets.length === 0 ? (
          <Notice
            title="Todavía no has registrado nada"
            body="Arma un parlay en el constructor y regístralo. A partir de ahí esta pantalla lleva la cuenta: resultado, ROI y si cogiste mejor precio que el de cierre."
          />
        ) : (
          bets.map((bet, index) => (
            <Rise key={bet.id} index={index}>
              <BetCard bet={bet} />
            </Rise>
          ))
        )}

        <Txt variant="caption" tone="ink3" style={styles.legal}>
          WagerWise no acepta ni cursa apuestas. Este historial es tu registro personal de lo que
          apostaste en otro sitio.
        </Txt>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// Piezas
// ─────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <GlassCard variant="inner" style={styles.statCell}>
      {/*
        El tracking ancho de `Overline` parte "APUESTAS" en dos líneas dentro de
        una celda de un tercio de pantalla, así que aquí se estrecha. Es el único
        sitio donde tres etiquetas comparten el ancho a la vez.
      */}
      <Txt variant="overline" tone="ink3" uppercase numberOfLines={1} style={styles.statLabel}>
        {label}
      </Txt>
      <Txt variant="title" style={styles.statValue}>
        {value}
      </Txt>
    </GlassCard>
  );
}

/**
 * CLV: lo único que dice algo del sistema con pocas apuestas.
 *
 * Con veinte resultados el P/L es casi todo varianza. Coger sistemáticamente
 * mejor precio que el de cierre, en cambio, sí predice beneficio a largo plazo,
 * así que merece su propia línea en vez de esconderse en una celda.
 */
function ClvLine({ stats }: { stats: BetStats }): React.ReactElement {
  if (stats.averageClv === null) {
    return (
      <Txt variant="caption" tone="ink3">
        CLV pendiente: se calcula cuando se captura la línea de cierre de cada partido.
      </Txt>
    );
  }

  const beat = stats.clvBeatRate ?? 0;

  return (
    <Txt variant="caption" tone={stats.averageClv >= 0 ? 'good' : 'ink3'}>
      CLV medio {formatSignedPercent(stats.averageClv)} · batiste la línea de cierre en{' '}
      {formatPercent(beat, 0)} de tus apuestas
    </Txt>
  );
}

function Sparkline({ curve }: { curve: number[] }): React.ReactElement | null {
  const { theme } = useTheme();
  if (curve.length < 2) return null;

  const points = downsample(curve, SPARK_BARS);
  // Escala simétrica alrededor de cero: así una barra hacia arriba y otra del
  // mismo tamaño hacia abajo significan la misma cantidad de dinero.
  const scale = Math.max(...points.map(Math.abs), 1);
  const half = SPARK_HEIGHT / 2;

  return (
    <View style={styles.spark} accessibilityLabel="Evolución del resultado acumulado">
      {points.map((value, index) => {
        const magnitude = Math.max(2, (Math.abs(value) / scale) * (half - 2));
        return (
          <View key={index} style={styles.sparkColumn}>
            <View style={styles.sparkTop}>
              {value >= 0 ? (
                <View
                  style={[styles.sparkBar, { height: magnitude, backgroundColor: theme.colors.accent }]}
                />
              ) : null}
            </View>
            <View style={styles.sparkBottom}>
              {value < 0 ? (
                <View
                  style={[styles.sparkBar, { height: magnitude, backgroundColor: theme.colors.bad }]}
                />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function BetCard({ bet }: { bet: BetView }): React.ReactElement {
  const { theme } = useTheme();
  const currency = isCurrencyCode(bet.currency) ? bet.currency : 'COP';
  const state = STATE_LABELS[bet.status];

  // Sólo cuando hubo anulación y el parlay llegó a pagar: en uno perdido la
  // cuota efectiva es cero y no dice nada.
  const effectiveOdds =
    bet.status === 'won' && bet.payout !== null && bet.legs.some((leg) => leg.status === 'void')
      ? bet.payout / bet.stake
      : null;

  const tone =
    bet.status === 'won' ? theme.colors.good : bet.status === 'lost' ? theme.colors.bad : theme.colors.accent;
  const soft =
    bet.status === 'won'
      ? theme.colors.goodSoft
      : bet.status === 'lost'
        ? theme.colors.badSoft
        : theme.colors.accentSoft;

  return (
    <GlassCard variant="card" style={styles.betCard}>
      <View style={styles.betHeader}>
        <View style={[styles.statePill, { backgroundColor: soft, borderRadius: theme.radius.pill }]}>
          <Txt variant="pill" style={{ color: tone }}>
            {state}
          </Txt>
        </View>

        <View style={styles.betTitle}>
          <Txt variant="bodySmall" numberOfLines={1}>
            {bet.title ?? `Parlay de ${bet.legs.length} legs`}
          </Txt>
          <Txt variant="caption" tone="ink3">
            {formatDay(bet.placedAt)} · stake {formatMoney(bet.stake, currency)}
          </Txt>
        </View>

        <View style={styles.betAmount}>
          <Txt
            variant="bodySmall"
            tone={bet.profit === null ? 'ink' : bet.profit > 0 ? 'good' : bet.profit < 0 ? 'bad' : 'ink'}
          >
            {bet.profit === null
              ? formatMoney(bet.stake * bet.combinedOdds, currency)
              : signedMoney(bet.profit, currency)}
          </Txt>
          <Txt variant="caption" tone="ink3">
            cuota {formatOdds(bet.combinedOdds)}
          </Txt>
        </View>
      </View>

      <Divider />

      <View style={styles.legList}>
        {bet.legs.map((leg) => (
          <View key={leg.id} style={styles.legRow}>
            <View style={[styles.legDot, { backgroundColor: dotColor(leg.status, theme.colors) }]} />
            <View style={styles.legText}>
              <Txt variant="caption" tone="ink2" numberOfLines={1}>
                {leg.label}
                {leg.status === 'void' ? ' · anulada' : ''}
              </Txt>
              <Txt variant="caption" tone="ink3" numberOfLines={1}>
                {leg.matchLabel}
              </Txt>
            </View>
            <Txt variant="caption" tone="ink3">
              {formatOdds(leg.odds)}
              {leg.closingOdds !== null ? ` · cierre ${formatOdds(leg.closingOdds)}` : ''}
            </Txt>
          </View>
        ))}
      </View>

      {/*
        Una leg anulada sale de la combinada, así que la cuota a la que se pagó
        no es la que se registró. Decirlo evita que el número de arriba parezca
        un error de cálculo.
      */}
      {effectiveOdds !== null ? (
        <Txt variant="caption" tone="warn">
          {bet.legs.filter((leg) => leg.status === 'void').length === 1
            ? 'Una leg anulada'
            : 'Legs anuladas'}
          : salió de la combinada y pagó a cuota {formatOdds(effectiveOdds)}.
        </Txt>
      ) : null}

      {bet.clv !== null ? (
        <Txt variant="caption" tone={bet.clv >= 0 ? 'good' : 'ink3'}>
          CLV {formatSignedPercent(bet.clv)} frente a la línea de cierre
        </Txt>
      ) : null}
    </GlassCard>
  );
}

function Notice({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <GlassCard variant="card" style={styles.notice}>
      <Txt variant="bodySmall">{title}</Txt>
      <Txt variant="caption" tone="ink2">
        {body}
      </Txt>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

const STATE_LABELS: Record<BetStatus, string> = {
  open: 'Abierta',
  won: 'Ganada',
  lost: 'Perdida',
  void: 'Anulada',
};

function dotColor(status: BetStatus, colors: { good: string; bad: string; ink3: string }): string {
  if (status === 'won') return colors.good;
  if (status === 'lost') return colors.bad;
  return colors.ink3;
}

function signedMoney(amount: number, currency: Parameters<typeof formatMoney>[1]): string {
  return `${amount > 0 ? '+' : ''}${formatMoney(amount, currency)}`;
}

function firstCurrency(bets: BetView[]): Parameters<typeof formatMoney>[1] | null {
  const code = bets[0]?.currency;
  return code && isCurrencyCode(code) ? code : null;
}

function formatDay(date: Date): string {
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/** Reduce la curva a `count` puntos conservando siempre el último. */
function downsample(values: number[], count: number): number[] {
  if (values.length <= count) return values;

  const step = (values.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => values[Math.round(i * step)]!);
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingBottom: 24, gap: 15 },
  header: { paddingHorizontal: 4, gap: 7 },

  hero: { padding: 22, gap: 16 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  profit: { marginTop: 8 },
  statRow: { flexDirection: 'row', gap: 10 },
  statCell: { flex: 1, padding: 12, gap: 7 },
  statLabel: { letterSpacing: 0.5 },
  statValue: {},

  spark: { flexDirection: 'row', alignItems: 'center', gap: 4, height: SPARK_HEIGHT },
  sparkColumn: { width: 7, height: SPARK_HEIGHT },
  sparkTop: { height: SPARK_HEIGHT / 2, justifyContent: 'flex-end' },
  sparkBottom: { height: SPARK_HEIGHT / 2, justifyContent: 'flex-start' },
  sparkBar: { width: 7, borderRadius: 4 },

  betCard: { padding: 16, gap: 12 },
  betHeader: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  statePill: { paddingHorizontal: 11, paddingVertical: 6 },
  betTitle: { flex: 1, minWidth: 0, gap: 4 },
  betAmount: { alignItems: 'flex-end', gap: 5 },

  legList: { gap: 9 },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  legDot: { width: 7, height: 7, borderRadius: 3.5 },
  legText: { flex: 1, minWidth: 0, gap: 2 },

  notice: { padding: 20, gap: 7 },
  legal: { paddingHorizontal: 6, paddingTop: 4 },
});
