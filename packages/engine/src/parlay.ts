/**
 * Evaluación y auditoría de parlays.
 *
 * El auditor es el diferenciador del producto. No se limita a avisar de que dos
 * legs están correlacionadas: recalcula la probabilidad conjunta correcta y
 * corrige el EV. El usuario ve el número real, no un número inflado con una
 * advertencia al lado.
 */

import {
  jointProbability,
  selectionCorrelation,
  selectionProbability,
  type Selection,
} from './markets.js';
import { expectedValue, type RiskProfile } from './value.js';

export interface ParlayLeg {
  id: string;
  /** Partido al que pertenece. Dos legs con el mismo `fixtureId` se correlacionan. */
  fixtureId: string;
  selection: Selection;
  /** Cuota decimal ofrecida. */
  odds: number;
  /** Probabilidad ya mezclada (modelo + mercado) para esta selección aislada. */
  probability: number;
  /** Etiqueta para la UI. */
  label?: string;
  matchLabel?: string;
}

/** Matriz de marcadores por partido, para calcular las conjuntas reales. */
export type ScoreMatrixByFixture = ReadonlyMap<string, readonly (readonly number[])[]>;

export interface ParlayEvaluation {
  combinedOdds: number;
  /** Probabilidad conjunta correcta: exacta dentro de cada partido. */
  trueProbability: number;
  /**
   * Probabilidad que saldría de multiplicar ingenuamente, asumiendo
   * independencia. Se conserva para poder mostrar la diferencia.
   */
  naiveProbability: number;
  impliedProbability: number;
  expectedValue: number;
  /** EV que habría reportado el cálculo ingenuo. Si difiere, hay correlación. */
  naiveExpectedValue: number;
  anyPushProbability: number;
  correlatedGroups: CorrelatedGroup[];
}

export interface CorrelatedGroup {
  fixtureId: string;
  legIds: string[];
  matchLabel?: string;
  /** Producto de las probabilidades individuales (lo ingenuo). */
  naiveProbability: number;
  /** Conjunta real desde la matriz. */
  trueProbability: number;
  /** Correlación phi entre el primer par del grupo, para explicarlo. */
  correlation: number;
}

/**
 * Evalúa un parlay con las probabilidades conjuntas correctas.
 *
 * Dentro de cada partido: suma exacta sobre la matriz de marcadores.
 * Entre partidos distintos: el producto, que sí es válido — son eventos
 * genuinamente independientes.
 */
export function evaluateParlay(
  legs: readonly ParlayLeg[],
  matrices: ScoreMatrixByFixture,
): ParlayEvaluation {
  if (legs.length === 0) {
    return {
      combinedOdds: 1,
      trueProbability: 0,
      naiveProbability: 0,
      impliedProbability: 0,
      expectedValue: 0,
      naiveExpectedValue: 0,
      anyPushProbability: 0,
      correlatedGroups: [],
    };
  }

  const combinedOdds = legs.reduce((acc, leg) => acc * leg.odds, 1);
  const naiveProbability = legs.reduce((acc, leg) => acc * leg.probability, 1);

  const byFixture = new Map<string, ParlayLeg[]>();
  for (const leg of legs) {
    const bucket = byFixture.get(leg.fixtureId);
    if (bucket) bucket.push(leg);
    else byFixture.set(leg.fixtureId, [leg]);
  }

  let trueProbability = 1;
  let noPushProbability = 1;
  const correlatedGroups: CorrelatedGroup[] = [];

  for (const [fixtureId, group] of byFixture) {
    const matrix = matrices.get(fixtureId);

    if (!matrix) {
      // Sin matriz no podemos hacer mejor que el producto. Es el peor caso y
      // hay que ser explícito: se degrada, no se falla en silencio.
      for (const leg of group) trueProbability *= leg.probability;
      continue;
    }

    const selections = group.map((leg) => leg.selection);
    const { win, anyPush } = jointProbability(matrix, selections);
    noPushProbability *= 1 - anyPush;

    // Las marginales son las de cada leg —la probabilidad calibrada, mezcla de
    // modelo y mercado— y la matriz sólo aporta cómo dependen entre sí las del
    // mismo partido. Tomar `win` tal cual sería usar el modelo puro, que es
    // justo lo que el backtesting descartó: con w = 0 el EV de un parlay de una
    // leg no coincidiría con el de esa misma selección suelta.
    const naive = group.reduce((acc, leg) => acc * leg.probability, 1);
    let joint = naive;

    if (group.length > 1) {
      const independent = group.reduce(
        (acc, leg) => acc * selectionProbability(matrix, leg.selection),
        1,
      );
      // `win / independent` es cuánto sube o baja la conjunta respecto a la
      // independencia según el modelo. Nunca puede superar a la leg menos
      // probable: dos sucesos no ocurren juntos más a menudo que el más raro.
      joint =
        independent > 0
          ? Math.min(naive * (win / independent), ...group.map((leg) => leg.probability))
          : naive;

      correlatedGroups.push({
        fixtureId,
        legIds: group.map((l) => l.id),
        matchLabel: group[0]!.matchLabel,
        naiveProbability: naive,
        trueProbability: joint,
        correlation: selectionCorrelation(matrix, selections[0]!, selections[1]!),
      });
    }

    trueProbability *= joint;
  }

  const anyPushProbability = 1 - noPushProbability;

  return {
    combinedOdds,
    trueProbability,
    naiveProbability,
    impliedProbability: 1 / combinedOdds,
    expectedValue: expectedValue(trueProbability, combinedOdds),
    naiveExpectedValue: expectedValue(naiveProbability, combinedOdds),
    anyPushProbability,
    correlatedGroups,
  };
}

export type CheckSeverity = 'ok' | 'warn' | 'bad';

export interface AuditCheck {
  id: 'correlation' | 'variance' | 'expected_value' | 'stake' | 'push';
  severity: CheckSeverity;
  title: string;
  body: string;
}

export interface AuditInput {
  legs: readonly ParlayLeg[];
  evaluation: ParlayEvaluation;
  profile: RiskProfile;
  bankroll: number;
  stakeAmount: number;
  /**
   * Los dos interruptores que el usuario tiene en Perfil.
   *
   * Silencian el **aviso**, nunca el cálculo: `evaluateParlay` sigue usando la
   * conjunta exacta aunque `correlationAudit` esté apagado. Un ajuste de la UI
   * no puede cambiar cuánto vale un parlay, sólo cuánto se insiste en ello.
   */
  settings?: { correlationAudit?: boolean; stakeLimit?: boolean };
}

export interface AuditResult {
  checks: AuditCheck[];
  warningCount: number;
  clean: boolean;
  /** Acción sugerida cuando hay algo que corregir. */
  fix?: { label: string; removeLegIds: string[] };
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/**
 * Las cuatro comprobaciones del diseño, más la de anulación.
 * Cada una devuelve el número real, no una advertencia genérica.
 */
export function auditParlay(input: AuditInput): AuditResult {
  const { legs, evaluation, profile, bankroll, stakeAmount } = input;
  const correlationAudit = input.settings?.correlationAudit ?? true;
  const stakeLimit = input.settings?.stakeLimit ?? true;
  const checks: AuditCheck[] = [];

  // 1. Correlación
  //
  // La dirección importa. El peligro real es que la conjunta sea PEOR que el
  // producto: ahí el parlay parece mejor de lo que es y el usuario apuesta de
  // más. Cuando es mejor, la correlación le favorece y marcarlo como aviso
  // sería alarmismo — basta con explicar que ya está corregido.
  if (!correlationAudit) {
    // Apagado en Perfil: ni aviso ni sello de aprobación. El EV que se muestra
    // arriba sigue siendo el de la conjunta exacta.
  } else if (evaluation.correlatedGroups.length > 0) {
    const group = evaluation.correlatedGroups[0]!;
    const harmful = group.trueProbability < group.naiveProbability;
    const where = group.matchLabel ? ` (${group.matchLabel})` : '';
    const detail =
      `Multiplicar cuotas asume independencia y daría ${pct(group.naiveProbability)}; ` +
      `la probabilidad conjunta real es ${pct(group.trueProbability)} ` +
      `(correlación ${group.correlation >= 0 ? '+' : ''}${group.correlation.toFixed(2)}).`;

    checks.push(
      harmful
        ? {
            id: 'correlation',
            severity: 'warn',
            title: 'Legs correlacionadas',
            body:
              `Dos selecciones del mismo partido${where}. ${detail} ` +
              'El parlay vale menos de lo que aparenta; ya hemos ajustado el EV a la baja.',
          }
        : {
            id: 'correlation',
            severity: 'ok',
            title: 'Correlación a tu favor',
            body:
              `Dos selecciones del mismo partido${where}. ${detail} ` +
              'En este caso la correlación te beneficia y el EV ajustado es mayor que el aparente.',
          },
    );
  } else if (legs.length >= 2) {
    checks.push({
      id: 'correlation',
      severity: 'ok',
      title: 'Sin correlación oculta',
      body: 'Cada leg viene de un partido distinto. La multiplicación de cuotas es válida.',
    });
  }

  // 2. Varianza
  if (legs.length === 0) {
    checks.push({
      id: 'variance',
      severity: 'warn',
      title: 'Parlay vacío',
      body: 'Añade al menos dos legs desde un partido o desde las alertas de valor.',
    });
  } else if (legs.length === 1) {
    checks.push({
      id: 'variance',
      severity: 'warn',
      title: 'Parlay incompleto',
      body: 'Añade al menos dos legs desde un partido o desde las alertas de valor.',
    });
  } else if (legs.length > profile.maxLegs) {
    checks.push({
      id: 'variance',
      severity: 'warn',
      title: 'Varianza alta',
      body:
        `${legs.length} legs dejan la probabilidad de acierto en ${pct(evaluation.trueProbability)}. ` +
        `Tu perfil ${profile.label.toLowerCase()} sugiere un máximo de ${profile.maxLegs}. ` +
        'Considera dividir en dos apuestas.',
    });
  } else {
    checks.push({
      id: 'variance',
      severity: 'ok',
      title: 'Tamaño razonable',
      body: `${legs.length} legs mantienen la probabilidad de acierto en ${pct(evaluation.trueProbability)}.`,
    });
  }

  // 3. Esperanza matemática
  if (legs.length > 0) {
    if (evaluation.expectedValue < 0) {
      checks.push({
        id: 'expected_value',
        severity: 'bad',
        title: 'EV negativo',
        body:
          `Esperanza de ${pct(evaluation.expectedValue)} por unidad apostada. ` +
          'A largo plazo esta apuesta pierde dinero.',
      });
    } else {
      checks.push({
        id: 'expected_value',
        severity: 'ok',
        title: 'EV positivo',
        body: `Esperanza de +${pct(evaluation.expectedValue)} con la probabilidad estimada. Margen de la casa ya descontado.`,
      });
    }
  }

  // 4. Stake
  const maxStake = bankroll * profile.maxStakePct;
  if (!stakeLimit) {
    // Sin el límite auto-impuesto no hay nada que comprobar aquí.
  } else if (stakeAmount > maxStake) {
    checks.push({
      id: 'stake',
      severity: 'warn',
      title: 'Stake sobre el límite',
      body:
        `Tu perfil ${profile.label.toLowerCase()} sugiere no pasar de ${pct(profile.maxStakePct)} ` +
        `del bankroll. Estás en ${pct(bankroll > 0 ? stakeAmount / bankroll : 0)}.`,
    });
  } else if (legs.length > 0) {
    checks.push({
      id: 'stake',
      severity: 'ok',
      title: 'Stake dentro del límite',
      body:
        `${pct(bankroll > 0 ? stakeAmount / bankroll : 0)} del bankroll, ` +
        `consistente con Kelly ${formatKelly(profile.kellyFraction)}.`,
    });
  }

  // 5. Anulación: una leg que empata el hándicap cae del parlay y baja la cuota.
  if (evaluation.anyPushProbability > 0.01) {
    checks.push({
      id: 'push',
      severity: 'warn',
      title: 'Riesgo de anulación',
      body:
        `Hay ${pct(evaluation.anyPushProbability)} de que alguna leg quede anulada ` +
        '(hándicap o total en línea entera). Si pasa, esa leg sale del parlay y la cuota baja.',
    });
  }

  const warningCount = checks.filter((c) => c.severity !== 'ok').length;

  return {
    checks,
    warningCount,
    clean: warningCount === 0,
    fix: buildFix(legs, evaluation),
  };
}

/**
 * Acción correctiva, en orden de prioridad: primero romper una correlación
 * dañina, luego quitar las legs que destruyen valor.
 *
 * Una correlación favorable no se "arregla": quitar esa leg empeoraría el
 * parlay, así que no se ofrece.
 */
function buildFix(
  legs: readonly ParlayLeg[],
  evaluation: ParlayEvaluation,
): AuditResult['fix'] {
  const harmful = evaluation.correlatedGroups.find(
    (g) => g.trueProbability < g.naiveProbability,
  );

  if (harmful) {
    // Quitamos la de menor ventaja individual del grupo correlacionado.
    const candidates = legs.filter((l) => harmful.legIds.includes(l.id));
    const worst = candidates.reduce((a, b) =>
      a.probability * a.odds <= b.probability * b.odds ? a : b,
    );
    return { label: 'Quitar la leg correlacionada', removeLegIds: [worst.id] };
  }

  // Sólo tiene sentido podar legs si el parlay en conjunto pierde valor. Una
  // leg individualmente -EV dentro de un parlay +EV no es un error: puede estar
  // aportando por correlación, y quitarla empeoraría el resultado.
  if (evaluation.expectedValue >= 0) return undefined;

  const negative = legs.filter((l) => l.probability * l.odds <= 1).map((l) => l.id);
  if (negative.length > 0 && negative.length < legs.length) {
    return { label: 'Quitar legs de EV negativo', removeLegIds: negative };
  }

  return undefined;
}

function formatKelly(fraction: number): string {
  const denominator = Math.round(1 / fraction);
  return `1/${denominator}`;
}
