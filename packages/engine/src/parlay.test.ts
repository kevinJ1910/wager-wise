import { describe, expect, it } from 'vitest';
import { scoreMatrixFromRates } from './dixon-coles.js';
import { selectionProbability, type Selection } from './markets.js';
import { auditParlay, evaluateParlay, type ParlayLeg } from './parlay.js';
import { RISK_PROFILES } from './value.js';

const betisGirona = scoreMatrixFromRates(1.75, 1.15, -0.03, 12);
const brightonNewcastle = scoreMatrixFromRates(1.65, 1.6, -0.03, 12);

const matrices = new Map([
  ['betis-girona', betisGirona],
  ['brighton-newcastle', brightonNewcastle],
]);

function leg(
  id: string,
  fixtureId: string,
  selection: Selection,
  odds: number,
  matrix: readonly (readonly number[])[],
): ParlayLeg {
  return {
    id,
    fixtureId,
    selection,
    odds,
    probability: selectionProbability(matrix, selection),
    matchLabel: fixtureId,
  };
}

describe('evaluación de parlays', () => {
  it('un parlay vacío no rompe', () => {
    const result = evaluateParlay([], matrices);
    expect(result.combinedOdds).toBe(1);
    expect(result.trueProbability).toBe(0);
    expect(result.correlatedGroups).toEqual([]);
  });

  it('multiplica las cuotas', () => {
    const legs = [
      leg('a', 'betis-girona', { kind: 'total_goals', line: 2.5, side: 'over' }, 1.72, betisGirona),
      leg('b', 'brighton-newcastle', { kind: 'total_goals', line: 2.5, side: 'over' }, 1.6, brightonNewcastle),
    ];
    expect(evaluateParlay(legs, matrices).combinedOdds).toBeCloseTo(1.72 * 1.6, 10);
  });

  it('entre partidos distintos la conjunta es el producto', () => {
    const legs = [
      leg('a', 'betis-girona', { kind: 'match_result', outcome: 'home' }, 1.95, betisGirona),
      leg('b', 'brighton-newcastle', { kind: 'total_goals', line: 2.5, side: 'over' }, 1.6, brightonNewcastle),
    ];
    const result = evaluateParlay(legs, matrices);
    expect(result.trueProbability).toBeCloseTo(result.naiveProbability, 10);
    expect(result.correlatedGroups).toHaveLength(0);
  });

  /**
   * El caso central del producto: el mockup avisaba de esta correlación pero
   * seguía multiplicando. Aquí el número que sale es el correcto.
   */
  it('corrige la conjunta de dos legs del mismo partido', () => {
    const legs = [
      leg('over', 'betis-girona', { kind: 'total_goals', line: 2.5, side: 'over' }, 1.72, betisGirona),
      leg('btts', 'betis-girona', { kind: 'btts', yes: true }, 1.68, betisGirona),
    ];

    const result = evaluateParlay(legs, matrices);

    expect(result.correlatedGroups).toHaveLength(1);
    // Correlación positiva: la conjunta real supera al producto ingenuo.
    expect(result.trueProbability).toBeGreaterThan(result.naiveProbability);
    expect(result.expectedValue).toBeGreaterThan(result.naiveExpectedValue);
    expect(result.correlatedGroups[0]!.correlation).toBeGreaterThan(0);
    expect(result.correlatedGroups[0]!.legIds).toEqual(['over', 'btts']);
  });

  it('corrige a la baja cuando la correlación es negativa', () => {
    const legs = [
      leg('home', 'betis-girona', { kind: 'match_result', outcome: 'home' }, 1.95, betisGirona),
      leg('under', 'betis-girona', { kind: 'total_goals', line: 2.5, side: 'under' }, 2.1, betisGirona),
    ];

    const result = evaluateParlay(legs, matrices);
    expect(result.trueProbability).toBeLessThan(result.naiveProbability);
    expect(result.expectedValue).toBeLessThan(result.naiveExpectedValue);
  });

  it('da probabilidad 0 a dos legs incompatibles del mismo partido', () => {
    const legs = [
      leg('home', 'betis-girona', { kind: 'match_result', outcome: 'home' }, 1.95, betisGirona),
      leg('away', 'betis-girona', { kind: 'match_result', outcome: 'away' }, 3.8, betisGirona),
    ];
    // Multiplicando daría ~11% y un parlay aparentemente jugable.
    const result = evaluateParlay(legs, matrices);
    expect(result.naiveProbability).toBeGreaterThan(0.05);
    expect(result.trueProbability).toBe(0);
    expect(result.expectedValue).toBeCloseTo(-1, 10);
  });

  it('se degrada al producto si falta la matriz, sin fallar', () => {
    const legs = [
      leg('a', 'desconocido', { kind: 'match_result', outcome: 'home' }, 2, betisGirona),
      leg('b', 'brighton-newcastle', { kind: 'btts', yes: true }, 1.8, brightonNewcastle),
    ];
    const result = evaluateParlay(legs, new Map([['brighton-newcastle', brightonNewcastle]]));
    expect(result.trueProbability).toBeGreaterThan(0);
  });

  it('reporta la probabilidad de anulación', () => {
    const legs = [
      leg('ah', 'betis-girona', { kind: 'asian_handicap', team: 'home', line: -1 }, 2.9, betisGirona),
    ];
    expect(evaluateParlay(legs, matrices).anyPushProbability).toBeGreaterThan(0);
  });
});

describe('auditor', () => {
  const bankroll = 1_200_000;
  const profile = RISK_PROFILES.balanced;

  const cleanLegs = [
    leg('a', 'betis-girona', { kind: 'total_goals', line: 2.5, side: 'over' }, 2.2, betisGirona),
    leg('b', 'brighton-newcastle', { kind: 'total_goals', line: 2.5, side: 'over' }, 2.1, brightonNewcastle),
  ];

  it('aprueba un parlay limpio', () => {
    const evaluation = evaluateParlay(cleanLegs, matrices);
    const audit = auditParlay({
      legs: cleanLegs,
      evaluation,
      profile,
      bankroll,
      stakeAmount: bankroll * 0.03,
    });

    expect(audit.clean).toBe(true);
    expect(audit.warningCount).toBe(0);
    expect(audit.fix).toBeUndefined();
    expect(audit.checks.every((c) => c.severity === 'ok')).toBe(true);
  });

  it('avisa y ofrece corregir cuando la correlación perjudica', () => {
    // "Gana el local" y "menos de 2.5 goles" correlacionan negativamente: la
    // conjunta real es menor que el producto, así que el parlay vale menos de
    // lo que aparenta. Este es el caso peligroso.
    const legs = [
      leg('home', 'betis-girona', { kind: 'match_result', outcome: 'home' }, 1.95, betisGirona),
      leg('under', 'betis-girona', { kind: 'total_goals', line: 2.5, side: 'under' }, 2.1, betisGirona),
    ];
    const evaluation = evaluateParlay(legs, matrices);
    const audit = auditParlay({
      legs,
      evaluation,
      profile,
      bankroll,
      stakeAmount: bankroll * 0.03,
    });

    expect(evaluation.trueProbability).toBeLessThan(evaluation.naiveProbability);

    const check = audit.checks.find((c) => c.id === 'correlation')!;
    expect(check.severity).toBe('warn');
    expect(check.title).toBe('Legs correlacionadas');
    expect(check.body).toContain('conjunta real');
    expect(audit.fix?.removeLegIds).toHaveLength(1);
  });

  it('no alarma ni propone quitar nada cuando la correlación favorece', () => {
    // "Más de 2.5" y "ambos marcan" correlacionan positivamente: la conjunta
    // real supera al producto. Quitar una leg empeoraría el parlay, así que no
    // debe ofrecerse como corrección.
    const legs = [
      leg('over', 'betis-girona', { kind: 'total_goals', line: 2.5, side: 'over' }, 1.72, betisGirona),
      leg('btts', 'betis-girona', { kind: 'btts', yes: true }, 1.68, betisGirona),
    ];
    const evaluation = evaluateParlay(legs, matrices);
    const audit = auditParlay({
      legs,
      evaluation,
      profile,
      bankroll,
      stakeAmount: bankroll * 0.03,
    });

    expect(evaluation.trueProbability).toBeGreaterThan(evaluation.naiveProbability);

    const check = audit.checks.find((c) => c.id === 'correlation')!;
    expect(check.severity).toBe('ok');
    expect(check.title).toBe('Correlación a tu favor');
    expect(audit.fix).toBeUndefined();
  });

  it('marca EV negativo', () => {
    const legs = [
      leg('a', 'betis-girona', { kind: 'match_result', outcome: 'home' }, 1.2, betisGirona),
      leg('b', 'brighton-newcastle', { kind: 'match_result', outcome: 'home' }, 1.2, brightonNewcastle),
    ];
    const audit = auditParlay({
      legs,
      evaluation: evaluateParlay(legs, matrices),
      profile,
      bankroll,
      stakeAmount: bankroll * 0.03,
    });

    const check = audit.checks.find((c) => c.id === 'expected_value')!;
    expect(check.severity).toBe('bad');
    expect(audit.clean).toBe(false);
  });

  it('marca el stake por encima del límite del perfil', () => {
    const audit = auditParlay({
      legs: cleanLegs,
      evaluation: evaluateParlay(cleanLegs, matrices),
      profile,
      bankroll,
      stakeAmount: bankroll * 0.5,
    });

    const check = audit.checks.find((c) => c.id === 'stake')!;
    expect(check.severity).toBe('warn');
  });

  it('marca varianza alta por exceso de legs', () => {
    const many = [
      ...cleanLegs,
      leg('c', 'betis-girona', { kind: 'match_result', outcome: 'home' }, 1.95, betisGirona),
      leg('d', 'brighton-newcastle', { kind: 'btts', yes: true }, 1.8, brightonNewcastle),
      leg('e', 'betis-girona', { kind: 'btts', yes: true }, 1.68, betisGirona),
    ];
    const audit = auditParlay({
      legs: many,
      evaluation: evaluateParlay(many, matrices),
      profile,
      bankroll,
      stakeAmount: bankroll * 0.03,
    });

    expect(audit.checks.find((c) => c.id === 'variance')!.severity).toBe('warn');
  });

  it('pide completar un parlay de una sola leg', () => {
    const audit = auditParlay({
      legs: [cleanLegs[0]!],
      evaluation: evaluateParlay([cleanLegs[0]!], matrices),
      profile,
      bankroll,
      stakeAmount: bankroll * 0.03,
    });

    const check = audit.checks.find((c) => c.id === 'variance')!;
    expect(check.title).toBe('Parlay incompleto');
  });

  it('prioriza romper la correlación dañina sobre quitar EV negativo', () => {
    // Correlación negativa (local + under) y además cuotas malas: las dos
    // correcciones aplicarían, pero romper la correlación va primero.
    const legs = [
      leg('home', 'betis-girona', { kind: 'match_result', outcome: 'home' }, 1.1, betisGirona),
      leg('under', 'betis-girona', { kind: 'total_goals', line: 2.5, side: 'under' }, 1.1, betisGirona),
    ];
    const evaluation = evaluateParlay(legs, matrices);
    const audit = auditParlay({
      legs,
      evaluation,
      profile,
      bankroll,
      stakeAmount: bankroll * 0.03,
    });

    expect(evaluation.expectedValue).toBeLessThan(0);
    expect(audit.fix?.label).toBe('Quitar la leg correlacionada');
  });

  it('no propone podar legs si el parlay ya tiene EV positivo', () => {
    // Una leg individualmente -EV dentro de un parlay +EV puede estar
    // aportando por correlación; quitarla empeoraría el resultado.
    const legs = [
      leg('over', 'betis-girona', { kind: 'total_goals', line: 2.5, side: 'over' }, 1.72, betisGirona),
      leg('btts', 'betis-girona', { kind: 'btts', yes: true }, 1.68, betisGirona),
    ];
    const evaluation = evaluateParlay(legs, matrices);
    const audit = auditParlay({
      legs,
      evaluation,
      profile,
      bankroll,
      stakeAmount: bankroll * 0.03,
    });

    expect(evaluation.expectedValue).toBeGreaterThan(0);
    expect(legs.some((l) => l.probability * l.odds <= 1)).toBe(true);
    expect(audit.fix).toBeUndefined();
  });
});
