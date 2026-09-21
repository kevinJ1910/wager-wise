/**
 * Liquidación de apuestas y captura de la línea de cierre.
 *
 * Hace tres cosas, en este orden y por una razón:
 *
 *   1. **Marca el cierre.** El último precio de cada casa antes del saque es la
 *      referencia contra la que se mide el CLV. Hay que capturarlo antes de que
 *      la ingesta de cuotas deje de traer ese partido, porque después ya no
 *      existe en ninguna parte.
 *   2. **Rellena la cuota de cierre de cada leg**, comparando la selección
 *      registrada contra los resultados del snapshot marcado.
 *   3. **Liquida** legs y parlays con las reglas del motor, e inserta el apunte
 *      de retorno en el ledger.
 *
 * No llama a ninguna API externa, así que no consume cuota y puede correr a
 * menudo. Va con service role: es el único camino por el que se escribe el
 * resultado de una apuesta, y eso no puede depender del cliente.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  parlayClv,
  parlayPayout,
  parlayStatus,
  settleLeg,
  type BetStatus,
  type Selection,
} from '../../../packages/engine/dist/index.js';
import { trackRun } from '../_shared/quota.ts';

/**
 * Cuánto atrás se miran los partidos ya jugados.
 *
 * Cubre de sobra el retraso de la ingesta en marcar un partido como terminado
 * sin arrastrar en cada pasada todo el histórico de la temporada.
 */
const LOOKBACK_DAYS = 14;

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const finishRun = await trackRun(supabase, 'settle-bets');
  const summary = {
    closingMarked: 0,
    closingOddsFilled: 0,
    legsSettled: 0,
    parlaysSettled: 0,
    notes: [] as string[],
  };

  try {
    const legs = await fetchPendingLegs(supabase);

    if (legs.length === 0) {
      await finishRun('ok', summary);
      return json(summary);
    }

    // ── 1 y 2: línea de cierre ──
    const fixtureIds = [...new Set(legs.map((leg) => leg.fixture_id))];

    for (const fixtureId of fixtureIds) {
      const fixture = legs.find((leg) => leg.fixture_id === fixtureId)!.fixtures;
      const marked = await markClosingSnapshots(supabase, fixtureId, fixture.kickoff_at);
      summary.closingMarked += marked;
    }

    const closing = await fetchClosingOutcomes(supabase, fixtureIds);

    for (const leg of legs) {
      if (leg.closing_odds !== null) continue;

      const odds = bestClosingOdds(closing.get(leg.fixture_id) ?? [], leg.selection);
      if (odds === null) continue;

      const { error } = await supabase
        .from('user_parlay_legs')
        .update({ closing_odds: odds })
        .eq('id', leg.id);

      if (error) {
        summary.notes.push(`Cierre de ${leg.id}: ${error.message}`);
        continue;
      }

      leg.closing_odds = odds;
      summary.closingOddsFilled += 1;
    }

    // ── 3: liquidación ──
    const touchedParlays = new Set<string>();

    for (const leg of legs) {
      const status = statusOf(leg);
      if (status === 'open') continue;

      const { error } = await supabase
        .from('user_parlay_legs')
        .update({ status, settled_at: new Date().toISOString() })
        .eq('id', leg.id);

      if (error) {
        summary.notes.push(`Leg ${leg.id}: ${error.message}`);
        continue;
      }

      leg.status = status;
      summary.legsSettled += 1;
      touchedParlays.add(leg.user_parlay_id);
    }

    for (const parlayId of touchedParlays) {
      const settled = await settleParlay(supabase, parlayId);
      if (settled === 'error') summary.notes.push(`Parlay ${parlayId}: no se pudo liquidar.`);
      else if (settled === 'settled') summary.parlaysSettled += 1;
    }

    await finishRun('ok', summary);
    return json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun('failed', { message, summary });
    return json({ error: message, summary }, 500);
  }
});

// ─────────────────────────────────────────────────────────────
// Legs pendientes
// ─────────────────────────────────────────────────────────────

interface PendingLeg {
  id: string;
  user_parlay_id: string;
  fixture_id: string;
  selection: Selection;
  odds: number;
  closing_odds: number | null;
  status: BetStatus;
  fixtures: {
    status: string;
    home_goals: number | null;
    away_goals: number | null;
    kickoff_at: string;
  };
}

async function fetchPendingLegs(supabase: SupabaseClient): Promise<PendingLeg[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from('user_parlay_legs')
    .select(
      `id, user_parlay_id, fixture_id, selection, odds, closing_odds, status,
       fixtures!inner(status, home_goals, away_goals, kickoff_at)`,
    )
    .eq('status', 'open')
    .lte('fixtures.kickoff_at', new Date().toISOString())
    .gte('fixtures.kickoff_at', since);

  if (error) throw new Error(`No se pudieron leer las legs abiertas: ${error.message}`);
  return (data ?? []) as unknown as PendingLeg[];
}

/**
 * Estado de una leg según su partido.
 *
 * Un aplazamiento **no** anula: la mayoría de partidos aplazados se juegan
 * semanas después y la apuesta sigue viva. Sólo la cancelación en firme
 * devuelve el dinero.
 */
function statusOf(leg: PendingLeg): BetStatus {
  if (leg.fixtures.status === 'cancelled') return 'void';
  if (leg.fixtures.status !== 'finished') return 'open';
  return settleLeg(leg.selection, leg.fixtures.home_goals, leg.fixtures.away_goals);
}

// ─────────────────────────────────────────────────────────────
// Línea de cierre
// ─────────────────────────────────────────────────────────────

interface SnapshotRow {
  id: number;
  bookmaker_id: string;
  market_kind: string;
  market_params: Record<string, unknown>;
  outcomes: { selection: Selection; odds: number }[];
  captured_at: string;
  is_closing: boolean;
}

/**
 * Marca como cierre el último snapshot de cada casa y mercado antes del saque.
 *
 * Idempotente: si el partido ya tiene cierres marcados no vuelve a tocarlo. El
 * índice único parcial del esquema es la red de seguridad si dos pasadas se
 * solapan.
 */
async function markClosingSnapshots(
  supabase: SupabaseClient,
  fixtureId: string,
  kickoffAt: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('odds_snapshots')
    .select('id, bookmaker_id, market_kind, market_params, outcomes, captured_at, is_closing')
    .eq('fixture_id', fixtureId)
    .lte('captured_at', kickoffAt)
    .order('captured_at', { ascending: false });

  if (error || !data || data.length === 0) return 0;

  const rows = data as unknown as SnapshotRow[];
  if (rows.some((row) => row.is_closing)) return 0;

  // Ya vienen del más reciente al más antiguo: el primero de cada grupo es el
  // cierre.
  const latest = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.bookmaker_id}:${row.market_kind}:${JSON.stringify(row.market_params)}`;
    if (!latest.has(key)) latest.set(key, row.id);
  }

  const ids = [...latest.values()];
  if (ids.length === 0) return 0;

  const { error: updateError } = await supabase
    .from('odds_snapshots')
    .update({ is_closing: true })
    .in('id', ids);

  return updateError ? 0 : ids.length;
}

async function fetchClosingOutcomes(
  supabase: SupabaseClient,
  fixtureIds: string[],
): Promise<Map<string, { selection: Selection; odds: number }[]>> {
  const { data, error } = await supabase
    .from('odds_snapshots')
    .select('fixture_id, outcomes')
    .in('fixture_id', fixtureIds)
    .eq('is_closing', true);

  if (error) throw new Error(`No se pudieron leer los cierres: ${error.message}`);

  const byFixture = new Map<string, { selection: Selection; odds: number }[]>();

  for (const row of (data ?? []) as { fixture_id: string; outcomes: unknown }[]) {
    if (!Array.isArray(row.outcomes)) continue;
    const bucket = byFixture.get(row.fixture_id) ?? [];
    bucket.push(...(row.outcomes as { selection: Selection; odds: number }[]));
    byFixture.set(row.fixture_id, bucket);
  }

  return byFixture;
}

/**
 * Mejor cuota de cierre para una selección.
 *
 * Mejor de mercado, igual que `best_odds` en las predicciones: comparar el
 * precio que el usuario cogió contra el mejor precio disponible al cierre es la
 * comparación que tiene sentido. Contra la media saldría un CLV inflado.
 */
function bestClosingOdds(
  outcomes: { selection: Selection; odds: number }[],
  selection: Selection,
): number | null {
  let best: number | null = null;

  for (const outcome of outcomes) {
    if (!sameSelection(outcome.selection, selection)) continue;
    if (best === null || outcome.odds > best) best = outcome.odds;
  }

  return best;
}

/** Igualdad estructural de selecciones, independiente del orden de las claves. */
function sameSelection(a: Selection, b: Selection): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);

  return `{${entries.join(',')}}`;
}

// ─────────────────────────────────────────────────────────────
// Parlays
// ─────────────────────────────────────────────────────────────

/**
 * Liquida un parlay si todas sus legs están decididas —o si una ya ha perdido,
 * que basta para saber el resultado— y apunta el retorno en el ledger.
 */
async function settleParlay(
  supabase: SupabaseClient,
  parlayId: string,
): Promise<'settled' | 'pending' | 'error'> {
  const { data: parlay, error: parlayError } = await supabase
    .from('user_parlays')
    .select('id, user_id, stake, status, title')
    .eq('id', parlayId)
    .maybeSingle();

  if (parlayError || !parlay) return 'error';
  // Ya liquidado en una pasada anterior: no se vuelve a pagar.
  if (parlay.status !== 'open') return 'pending';

  const { data: legs, error: legsError } = await supabase
    .from('user_parlay_legs')
    .select('status, odds, closing_odds')
    .eq('user_parlay_id', parlayId);

  if (legsError || !legs || legs.length === 0) return 'error';

  const typed = legs as { status: BetStatus; odds: number; closing_odds: number | null }[];
  const status = parlayStatus(typed);
  if (status === 'open') return 'pending';

  const stake = Number(parlay.stake);
  const payout = parlayPayout(typed, stake);
  const clv = parlayClv(typed.map((leg) => ({ odds: leg.odds, closingOdds: leg.closing_odds })));

  const { data: updated, error: updateError } = await supabase
    .from('user_parlays')
    .update({ status, payout, clv, settled_at: new Date().toISOString() })
    .eq('id', parlayId)
    // Condición de carrera: si otra pasada lo liquidó entre la lectura y aquí,
    // esta actualización no toca ninguna fila.
    .eq('status', 'open')
    .select('id');

  if (updateError) return 'error';
  // Nadie ha ganado esta carrera excepto quien actualizó la fila; sin fila
  // actualizada no se apunta el retorno, o se pagaría dos veces.
  if (!updated || updated.length === 0) return 'pending';

  const { error: ledgerError } = await supabase.from('bankroll_transactions').insert({
    user_id: parlay.user_id,
    amount: payout,
    kind: 'settlement',
    parlay_id: parlayId,
    note: parlay.title,
  });

  if (ledgerError) return 'error';
  return 'settled';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
