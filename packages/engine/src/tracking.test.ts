import { describe, expect, it } from 'vitest';
import {
  closingLineValue,
  parlayClv,
  parlayPayout,
  parlayStatus,
  settleLeg,
  summarizeBets,
  type TrackedBet,
} from './tracking.js';

describe('parlayStatus', () => {
  it('una leg perdida tumba el parlay aunque queden legs abiertas', () => {
    // Esperar al resto de partidos no cambiaría nada: el dinero ya está perdido
    // y el usuario tiene derecho a saberlo hoy, no el domingo.
    expect(parlayStatus([{ status: 'lost' }, { status: 'open' }])).toBe('lost');
  });

  it('sigue abierto mientras quede una leg sin resolver', () => {
    expect(parlayStatus([{ status: 'won' }, { status: 'open' }])).toBe('open');
  });

  it('gana sólo cuando ninguna leg falla', () => {
    expect(parlayStatus([{ status: 'won' }, { status: 'won' }])).toBe('won');
  });

  it('una leg anulada no impide ganar', () => {
    expect(parlayStatus([{ status: 'won' }, { status: 'void' }])).toBe('won');
  });

  it('todas anuladas es anulado, no ganado', () => {
    expect(parlayStatus([{ status: 'void' }, { status: 'void' }])).toBe('void');
  });

  it('un parlay sin legs está abierto', () => {
    expect(parlayStatus([])).toBe('open');
  });
});

describe('parlayPayout', () => {
  it('multiplica las cuotas de las legs ganadas', () => {
    const payout = parlayPayout(
      [
        { status: 'won', odds: 2 },
        { status: 'won', odds: 1.5 },
      ],
      10_000,
    );
    expect(payout).toBe(30_000);
  });

  it('la leg anulada sale de la combinada en vez de contar como ganada', () => {
    const payout = parlayPayout(
      [
        { status: 'won', odds: 2 },
        { status: 'void', odds: 1.9 },
      ],
      10_000,
    );
    expect(payout).toBe(20_000);
  });

  it('una leg perdida deja el retorno en cero', () => {
    const payout = parlayPayout(
      [
        { status: 'won', odds: 2 },
        { status: 'lost', odds: 3 },
      ],
      10_000,
    );
    expect(payout).toBe(0);
  });

  it('todas anuladas devuelven el stake', () => {
    expect(parlayPayout([{ status: 'void', odds: 2 }], 10_000)).toBe(10_000);
  });

  it('un parlay abierto no paga todavía', () => {
    const payout = parlayPayout(
      [
        { status: 'won', odds: 2 },
        { status: 'open', odds: 3 },
      ],
      10_000,
    );
    expect(payout).toBe(0);
  });
});

describe('settleLeg', () => {
  it('sin marcador la leg sigue abierta', () => {
    expect(settleLeg({ kind: 'match_result', outcome: 'home' }, null, null)).toBe('open');
  });

  it('0-0 no es "sin marcador"', () => {
    // El bug clásico: tratar 0 como ausencia y dejar abiertas las legs de un
    // partido que acabó sin goles.
    expect(settleLeg({ kind: 'match_result', outcome: 'draw' }, 0, 0)).toBe('won');
    expect(settleLeg({ kind: 'btts', yes: true }, 0, 0)).toBe('lost');
  });

  it('el total clavado en línea entera se anula', () => {
    expect(settleLeg({ kind: 'total_goals', line: 3, side: 'over' }, 2, 1)).toBe('void');
  });

  it('resuelve el hándicap asiático con la línea aplicada', () => {
    expect(settleLeg({ kind: 'asian_handicap', team: 'home', line: -1 }, 2, 0)).toBe('won');
    expect(settleLeg({ kind: 'asian_handicap', team: 'home', line: -1 }, 1, 0)).toBe('void');
  });
});

describe('closing line value', () => {
  it('es positivo cuando se cogió mejor precio que el de cierre', () => {
    expect(closingLineValue(2.2, 2)).toBeCloseTo(0.1, 10);
  });

  it('es negativo cuando la línea se movió a favor de la casa', () => {
    expect(closingLineValue(1.9, 2)).toBeCloseTo(-0.05, 10);
  });

  it('el CLV del parlay compara combinada contra combinada', () => {
    const clv = parlayClv([
      { odds: 2, closingOdds: 1.9 },
      { odds: 2, closingOdds: 2 },
    ]);
    // 4 / 3.8 − 1
    expect(clv).toBeCloseTo(0.0526, 4);
  });

  it('sin cierre en una leg no hay CLV que reportar', () => {
    expect(parlayClv([{ odds: 2, closingOdds: 1.9 }, { odds: 2, closingOdds: null }])).toBeNull();
  });
});

describe('summarizeBets', () => {
  const bet = (over: Partial<TrackedBet>): TrackedBet => ({
    stake: 10_000,
    status: 'won',
    payout: 20_000,
    clv: null,
    ...over,
  });

  it('un historial vacío no inventa un ROI', () => {
    const stats = summarizeBets([]);
    expect(stats.roi).toBe(0);
    expect(stats.hitRate).toBe(0);
    expect(stats.curve).toEqual([]);
  });

  it('separa lo abierto de lo liquidado', () => {
    const stats = summarizeBets([
      bet({ status: 'open', payout: null, settledAt: null }),
      bet({ status: 'won', payout: 25_000, settledAt: '2026-09-01' }),
    ]);

    expect(stats.open).toBe(1);
    expect(stats.openStake).toBe(10_000);
    expect(stats.settled).toBe(1);
    expect(stats.profit).toBe(15_000);
  });

  it('el ROI es beneficio sobre lo arriesgado', () => {
    const stats = summarizeBets([
      bet({ status: 'won', payout: 30_000, settledAt: '2026-09-01' }),
      bet({ status: 'lost', payout: 0, settledAt: '2026-09-02' }),
    ]);

    // 20.000 ganados menos 10.000 perdidos, sobre 20.000 arriesgados.
    expect(stats.profit).toBe(10_000);
    expect(stats.roi).toBeCloseTo(0.5, 10);
    expect(stats.hitRate).toBeCloseTo(0.5, 10);
  });

  it('las anuladas no cuentan como arriesgadas ni como falladas', () => {
    const stats = summarizeBets([
      bet({ status: 'void', payout: 10_000, settledAt: '2026-09-01' }),
      bet({ status: 'won', payout: 20_000, settledAt: '2026-09-02' }),
    ]);

    expect(stats.voided).toBe(1);
    expect(stats.staked).toBe(10_000);
    expect(stats.hitRate).toBe(1);
    expect(stats.profit).toBe(10_000);
  });

  it('la curva sigue el orden de liquidación, no el de llegada', () => {
    // Las filas llegan de PostgREST ordenadas por fecha de registro; si la
    // curva se construyera así, una apuesta antigua liquidada tarde dibujaría
    // una caída donde no la hubo.
    const stats = summarizeBets([
      bet({ status: 'lost', payout: 0, settledAt: '2026-09-05' }),
      bet({ status: 'won', payout: 30_000, settledAt: '2026-09-01' }),
    ]);

    expect(stats.curve).toEqual([20_000, 10_000]);
  });

  it('promedia el CLV sólo sobre las apuestas que lo tienen', () => {
    const stats = summarizeBets([
      bet({ status: 'won', payout: 20_000, clv: 0.04, settledAt: '2026-09-01' }),
      bet({ status: 'lost', payout: 0, clv: -0.02, settledAt: '2026-09-02' }),
      bet({ status: 'lost', payout: 0, clv: null, settledAt: '2026-09-03' }),
    ]);

    expect(stats.averageClv).toBeCloseTo(0.01, 10);
    expect(stats.clvBeatRate).toBeCloseTo(0.5, 10);
  });

  it('sin ninguna línea de cierre el CLV es nulo, no cero', () => {
    const stats = summarizeBets([bet({ settledAt: '2026-09-01' })]);
    expect(stats.averageClv).toBeNull();
    expect(stats.clvBeatRate).toBeNull();
  });
});
