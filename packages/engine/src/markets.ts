/**
 * Derivación de mercados desde la matriz de marcadores.
 *
 * Aquí está el núcleo de lo que diferencia a WagerWise. Multiplicar
 * probabilidades sólo es válido bajo independencia, y dos selecciones del mismo
 * partido nunca son independientes: "gana el local" y "más de 2.5 goles"
 * comparten los mismos 90 minutos.
 *
 * Como toda selección es un predicado sobre el marcador final, la probabilidad
 * conjunta de varias selecciones del mismo partido es simplemente la suma de
 * las celdas de la matriz donde todas se cumplen. Eso es exacto, no una
 * aproximación, y no necesita estimar ninguna correlación.
 */

/** Una selección apostable, expresada como predicado sobre el marcador final. */
export type Selection =
  | { kind: 'match_result'; outcome: 'home' | 'draw' | 'away' }
  | { kind: 'double_chance'; outcome: 'home_draw' | 'home_away' | 'draw_away' }
  | { kind: 'total_goals'; line: number; side: 'over' | 'under' }
  | { kind: 'team_total'; team: 'home' | 'away'; line: number; side: 'over' | 'under' }
  | { kind: 'btts'; yes: boolean }
  | { kind: 'asian_handicap'; team: 'home' | 'away'; line: number }
  | { kind: 'correct_score'; homeGoals: number; awayGoals: number };

export type SelectionOutcome = 'win' | 'push' | 'loss';

export interface SelectionProbabilities {
  win: number;
  /** Probabilidad de anulación (devuelve el stake). Sólo en líneas enteras. */
  push: number;
  loss: number;
}

/**
 * Resuelve una selección contra un marcador concreto.
 *
 * `push` aparece cuando el resultado anula la apuesta: hándicap entero que
 * acaba en empate ajustado, o total en línea entera clavada.
 */
export function resolveSelection(
  selection: Selection,
  homeGoals: number,
  awayGoals: number,
): SelectionOutcome {
  switch (selection.kind) {
    case 'match_result': {
      const actual = homeGoals > awayGoals ? 'home' : homeGoals < awayGoals ? 'away' : 'draw';
      return actual === selection.outcome ? 'win' : 'loss';
    }

    case 'double_chance': {
      const actual = homeGoals > awayGoals ? 'home' : homeGoals < awayGoals ? 'away' : 'draw';
      const allowed: Record<typeof selection.outcome, readonly string[]> = {
        home_draw: ['home', 'draw'],
        home_away: ['home', 'away'],
        draw_away: ['draw', 'away'],
      };
      return allowed[selection.outcome].includes(actual) ? 'win' : 'loss';
    }

    case 'total_goals': {
      const total = homeGoals + awayGoals;
      if (total === selection.line) return 'push';
      const isOver = total > selection.line;
      return isOver === (selection.side === 'over') ? 'win' : 'loss';
    }

    case 'team_total': {
      const goals = selection.team === 'home' ? homeGoals : awayGoals;
      if (goals === selection.line) return 'push';
      const isOver = goals > selection.line;
      return isOver === (selection.side === 'over') ? 'win' : 'loss';
    }

    case 'btts':
      return (homeGoals > 0 && awayGoals > 0) === selection.yes ? 'win' : 'loss';

    case 'asian_handicap': {
      // La línea se suma al equipo elegido: -1 significa que debe ganar por 2+.
      const margin =
        selection.team === 'home' ? homeGoals - awayGoals : awayGoals - homeGoals;
      const adjusted = margin + selection.line;
      if (adjusted === 0) return 'push';
      return adjusted > 0 ? 'win' : 'loss';
    }

    case 'correct_score':
      return homeGoals === selection.homeGoals && awayGoals === selection.awayGoals
        ? 'win'
        : 'loss';
  }
}

/** Probabilidades de una selección a partir de la matriz de marcadores. */
export function selectionProbabilities(
  matrix: readonly (readonly number[])[],
  selection: Selection,
): SelectionProbabilities {
  let win = 0;
  let push = 0;
  let loss = 0;

  for (let h = 0; h < matrix.length; h++) {
    const row = matrix[h]!;
    for (let a = 0; a < row.length; a++) {
      const p = row[a]!;
      switch (resolveSelection(selection, h, a)) {
        case 'win':
          win += p;
          break;
        case 'push':
          push += p;
          break;
        case 'loss':
          loss += p;
          break;
      }
    }
  }

  return { win, push, loss };
}

/** Atajo: probabilidad de acierto de una selección. */
export function selectionProbability(
  matrix: readonly (readonly number[])[],
  selection: Selection,
): number {
  return selectionProbabilities(matrix, selection).win;
}

/**
 * Probabilidad conjunta **exacta** de varias selecciones del mismo partido.
 *
 * Suma las celdas donde todas ganan. Nunca multiplica, así que captura la
 * correlación real sin estimar ningún coeficiente.
 *
 * Devuelve también `anyPush`, la probabilidad de que alguna selección se anule:
 * eso cambia la estructura del parlay (la leg se cae y la cuota baja) y el
 * auditor necesita saberlo.
 */
export function jointProbability(
  matrix: readonly (readonly number[])[],
  selections: readonly Selection[],
): { win: number; anyPush: number } {
  if (selections.length === 0) return { win: 1, anyPush: 0 };

  let win = 0;
  let anyPush = 0;

  for (let h = 0; h < matrix.length; h++) {
    const row = matrix[h]!;
    for (let a = 0; a < row.length; a++) {
      const p = row[a]!;
      if (p === 0) continue;

      let allWin = true;
      let pushed = false;
      for (const s of selections) {
        const outcome = resolveSelection(s, h, a);
        if (outcome === 'push') pushed = true;
        if (outcome !== 'win') allWin = false;
      }

      if (pushed) anyPush += p;
      if (allWin) win += p;
    }
  }

  return { win, anyPush };
}

/**
 * Correlación implícita entre dos selecciones del mismo partido.
 *
 * Sólo se usa para mostrarle al usuario *por qué* se marcó una leg — el cálculo
 * de valor nunca pasa por aquí, usa `jointProbability` directamente.
 * Devuelve el coeficiente phi entre los dos sucesos binarios.
 */
export function selectionCorrelation(
  matrix: readonly (readonly number[])[],
  a: Selection,
  b: Selection,
): number {
  const pa = selectionProbability(matrix, a);
  const pb = selectionProbability(matrix, b);
  const joint = jointProbability(matrix, [a, b]).win;

  const denominator = Math.sqrt(pa * (1 - pa) * pb * (1 - pb));
  if (denominator === 0) return 0;
  return (joint - pa * pb) / denominator;
}

/** Probabilidades 1X2 desde la matriz. */
export function matchResultProbabilities(matrix: readonly (readonly number[])[]): {
  home: number;
  draw: number;
  away: number;
} {
  return {
    home: selectionProbability(matrix, { kind: 'match_result', outcome: 'home' }),
    draw: selectionProbability(matrix, { kind: 'match_result', outcome: 'draw' }),
    away: selectionProbability(matrix, { kind: 'match_result', outcome: 'away' }),
  };
}

/** Etiqueta legible en español, para la UI y para el prompt de la IA. */
export function describeSelection(selection: Selection): string {
  switch (selection.kind) {
    case 'match_result':
      return { home: 'Gana el local', draw: 'Empate', away: 'Gana el visitante' }[
        selection.outcome
      ];
    case 'double_chance':
      return {
        home_draw: 'Local o empate (1X)',
        home_away: 'Local o visitante (12)',
        draw_away: 'Empate o visitante (X2)',
      }[selection.outcome];
    case 'total_goals':
      return `${selection.side === 'over' ? 'Más' : 'Menos'} de ${selection.line} goles`;
    case 'team_total':
      return `${selection.team === 'home' ? 'Local' : 'Visitante'}: ${
        selection.side === 'over' ? 'más' : 'menos'
      } de ${selection.line} goles`;
    case 'btts':
      return selection.yes ? 'Ambos marcan' : 'No marcan ambos';
    case 'asian_handicap': {
      const sign = selection.line > 0 ? '+' : '';
      return `${selection.team === 'home' ? 'Local' : 'Visitante'} ${sign}${selection.line}`;
    }
    case 'correct_score':
      return `Resultado exacto ${selection.homeGoals}-${selection.awayGoals}`;
  }
}
