/**
 * La forma que consumen las pantallas, venga de Supabase o de los datos de
 * muestra.
 *
 * Es deliberadamente la misma para ambas fuentes: así una pantalla no sabe —ni
 * necesita saber— si está pintando datos reales o de muestra, y el camino de
 * código que se prueba en desarrollo es el que corre en producción.
 */

import type { Selection } from '@wagerwise/engine';

export interface MarketOffer {
  id: string;
  selection: Selection;
  label: string;
  odds: number;
  modelProbability: number;
  marketProbability: number;
  blendedProbability: number;
  edge: number;
  expectedValue: number;
  /** Casa que ofrece la mejor cuota. Ausente en los datos de muestra. */
  bookmaker?: string;
}

export interface FixtureView {
  id: string;
  league: string;
  /** Hora local ya formateada, como la pinta la tarjeta. */
  kickoff: string;
  kickoffAt?: Date;
  homeTeam: string;
  awayTeam: string;
  /** Goles esperados del local y del visitante, según el modelo. */
  lambda: number;
  mu: number;
  /** Matriz de marcadores: de aquí salen las conjuntas del builder. */
  matrix: number[][];
  /**
   * Cuotas 1-X-2. Nula cuando ninguna casa ha publicado todavía el mercado:
   * la tarjeta muestra huecos antes que inventar un precio que nadie ofrece.
   */
  matchOdds: [number, number, number] | null;
  markets: MarketOffer[];
  /** Mejor EV entre sus mercados, para ordenar la lista de Hoy. */
  bestEv: number;
  modelSplit: { home: number; draw: number; away: number };
}

/** Explicación de Gemini para una selección concreta. */
export interface FixtureAnalysis {
  id: string;
  fixtureId: string;
  reasoning: string;
  facts: { label: string; value: string }[];
  confidence: number | null;
  veto: boolean;
  vetoReason: string | null;
  model: string;
}

export function formatKickoff(date: Date): string {
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

/**
 * El "parlay del día": las mejores selecciones de partidos distintos.
 *
 * Exigir partidos distintos no es cosmético — es lo que mantiene válida la
 * multiplicación de cuotas. Dos legs del mismo partido exigirían la conjunta
 * de la matriz, y el auditor del builder lo marcaría.
 */
export function bestParlay(
  fixtures: FixtureView[],
  legs = 3,
): { fixture: FixtureView; market: MarketOffer }[] {
  const seen = new Set<string>();
  const picks: { fixture: FixtureView; market: MarketOffer }[] = [];

  const candidates = fixtures
    .flatMap((fixture) => fixture.markets.map((market) => ({ fixture, market })))
    .sort((a, b) => b.market.expectedValue - a.market.expectedValue);

  for (const candidate of candidates) {
    if (picks.length >= legs) break;
    if (seen.has(candidate.fixture.id)) continue;
    if (candidate.market.expectedValue <= 0) continue;
    seen.add(candidate.fixture.id);
    picks.push(candidate);
  }

  return picks;
}
