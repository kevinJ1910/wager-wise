/**
 * Liquidación de apuestas y estadísticas de seguimiento.
 *
 * Vive en el motor —y no en la Edge Function que liquida, ni en la pantalla que
 * pinta el historial— porque las dos necesitan exactamente las mismas reglas.
 * Si el backend decidiera que un parlay con una leg anulada está perdido y la
 * app lo pintara como ganado, el usuario vería dos verdades distintas del mismo
 * dinero. Aquí sólo hay una, y está cubierta por tests.
 */

import { resolveSelection, type Selection } from './markets.js';

export type BetStatus = 'open' | 'won' | 'lost' | 'void';

export interface SettledLeg {
  status: BetStatus;
  /** Cuota a la que se registró la leg. */
  odds: number;
}

/**
 * Estado de un parlay a partir del de sus legs.
 *
 * El orden de las reglas importa: **una sola leg perdida mata el parlay**,
 * aunque las demás sigan abiertas. Esperar a que terminen los otros partidos
 * para decir lo que ya se sabe sería mentirle al usuario sobre su exposición.
 */
export function parlayStatus(legs: readonly { status: BetStatus }[]): BetStatus {
  if (legs.length === 0) return 'open';
  if (legs.some((leg) => leg.status === 'lost')) return 'lost';
  if (legs.some((leg) => leg.status === 'open')) return 'open';
  if (legs.every((leg) => leg.status === 'void')) return 'void';
  return 'won';
}

/**
 * Retorno bruto de un parlay liquidado, stake incluido.
 *
 * Una leg anulada no tumba el parlay ni lo hace ganar: sale de la combinada y
 * la cuota baja, que es justo lo que el auditor avisa antes de registrar.
 */
export function parlayPayout(legs: readonly SettledLeg[], stake: number): number {
  if (legs.some((leg) => leg.status === 'lost')) return 0;
  if (legs.some((leg) => leg.status === 'open')) return 0;

  const odds = legs.reduce((acc, leg) => (leg.status === 'won' ? acc * leg.odds : acc), 1);
  return stake * odds;
}

/**
 * Resultado de una leg contra el marcador final.
 *
 * `null` en los goles significa que el partido no ha terminado, no que acabara
 * 0-0: sin marcador la leg sigue abierta.
 */
export function settleLeg(
  selection: Selection,
  homeGoals: number | null,
  awayGoals: number | null,
): BetStatus {
  if (homeGoals === null || awayGoals === null) return 'open';

  switch (resolveSelection(selection, homeGoals, awayGoals)) {
    case 'win':
      return 'won';
    case 'push':
      return 'void';
    case 'loss':
      return 'lost';
  }
}

// ─────────────────────────────────────────────────────────────
// Closing line value
// ─────────────────────────────────────────────────────────────

/**
 * Valor frente a la línea de cierre.
 *
 * Es la métrica honesta para juzgar un sistema antes de tener cientos de
 * apuestas: el resultado de una apuesta concreta es casi todo varianza, pero
 * coger sistemáticamente un precio mejor que el de cierre sí predice beneficio.
 * Positivo = apostaste a mejor cuota de la que había al final.
 */
export function closingLineValue(oddsTaken: number, closingOdds: number): number {
  if (closingOdds <= 0) throw new RangeError('La cuota de cierre debe ser positiva.');
  return oddsTaken / closingOdds - 1;
}

/**
 * CLV de un parlay completo: la combinada tomada frente a la de cierre.
 *
 * Devuelve `null` si a alguna leg le falta el cierre — un CLV calculado sobre
 * media combinada no es un CLV, es un número con la misma pinta.
 */
export function parlayClv(
  legs: readonly { odds: number; closingOdds: number | null | undefined }[],
): number | null {
  if (legs.length === 0) return null;

  let taken = 1;
  let closing = 1;

  for (const leg of legs) {
    if (leg.closingOdds === null || leg.closingOdds === undefined || leg.closingOdds <= 0) {
      return null;
    }
    taken *= leg.odds;
    closing *= leg.closingOdds;
  }

  return taken / closing - 1;
}

// ─────────────────────────────────────────────────────────────
// Estadísticas del historial
// ─────────────────────────────────────────────────────────────

export interface TrackedBet {
  stake: number;
  status: BetStatus;
  /** Retorno bruto, stake incluido. Null mientras la apuesta siga abierta. */
  payout: number | null;
  clv: number | null;
  /** ISO. Ordena la curva de P/L; las abiertas no la tocan. */
  settledAt?: string | null;
}

export interface BetStats {
  /** Apuestas ya resueltas, anuladas incluidas. */
  settled: number;
  open: number;
  /** Dinero en juego ahora mismo. */
  openStake: number;
  /** Stake arriesgado de verdad: las anuladas no cuentan, devuelven el dinero. */
  staked: number;
  returned: number;
  profit: number;
  /** Beneficio sobre lo arriesgado. 0 sin apuestas liquidadas. */
  roi: number;
  /** Aciertos sobre decididas. Las anuladas no entran ni arriba ni abajo. */
  hitRate: number;
  won: number;
  lost: number;
  voided: number;
  averageClv: number | null;
  /** Fracción de apuestas que batieron la línea de cierre. */
  clvBeatRate: number | null;
  /** P/L acumulado tras cada liquidación, en orden cronológico. */
  curve: number[];
}

const EMPTY: BetStats = {
  settled: 0,
  open: 0,
  openStake: 0,
  staked: 0,
  returned: 0,
  profit: 0,
  roi: 0,
  hitRate: 0,
  won: 0,
  lost: 0,
  voided: 0,
  averageClv: null,
  clvBeatRate: null,
  curve: [],
};

/**
 * Resume un historial de apuestas.
 *
 * Ordena por fecha de liquidación en vez de fiarse del orden de entrada: una
 * curva de P/L construida sobre filas desordenadas dibuja una historia falsa
 * sin fallar por ningún lado, que es la peor clase de error.
 */
export function summarizeBets(bets: readonly TrackedBet[]): BetStats {
  if (bets.length === 0) return { ...EMPTY };

  const stats: BetStats = { ...EMPTY, curve: [] };

  const settled = bets
    .filter((bet) => bet.status !== 'open')
    .slice()
    .sort((a, b) => (a.settledAt ?? '').localeCompare(b.settledAt ?? ''));

  for (const bet of bets) {
    if (bet.status !== 'open') continue;
    stats.open += 1;
    stats.openStake += bet.stake;
  }

  let cumulative = 0;
  const clvs: number[] = [];

  for (const bet of settled) {
    const payout = bet.payout ?? 0;
    stats.settled += 1;

    if (bet.status === 'void') {
      stats.voided += 1;
    } else {
      stats.staked += bet.stake;
      stats.returned += payout;
      cumulative += payout - bet.stake;
      if (bet.status === 'won') stats.won += 1;
      else stats.lost += 1;
    }

    stats.curve.push(cumulative);
    if (bet.clv !== null && bet.clv !== undefined) clvs.push(bet.clv);
  }

  stats.profit = cumulative;
  stats.roi = stats.staked > 0 ? stats.profit / stats.staked : 0;

  const decided = stats.won + stats.lost;
  stats.hitRate = decided > 0 ? stats.won / decided : 0;

  if (clvs.length > 0) {
    stats.averageClv = clvs.reduce((a, b) => a + b, 0) / clvs.length;
    stats.clvBeatRate = clvs.filter((clv) => clv > 0).length / clvs.length;
  }

  return stats;
}
