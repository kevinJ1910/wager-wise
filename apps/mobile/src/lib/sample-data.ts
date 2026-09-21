/**
 * Datos de muestra para desarrollar sin claves de API.
 *
 * Las cuotas y los enfrentamientos salen del mockup, pero **las probabilidades
 * no están escritas a mano**: se derivan con `@wagerwise/engine` de una matriz
 * de marcadores real. Así la pantalla del builder enseña la matemática
 * verdadera —incluida la corrección de correlación— aunque la entrada sea
 * ficticia.
 *
 * La app marca visiblemente cuándo está usando esto. Nunca debe confundirse con
 * datos reales.
 */

import {
  blendProbabilities,
  consensusProbabilities,
  describeSelection,
  edge,
  expectedValue,
  scoreMatrixFromRates,
  selectionProbability,
  type Selection,
} from '@wagerwise/engine';
import type { FixtureView, MarketOffer } from './fixtures.js';

/** Los datos de muestra cumplen el mismo contrato que los reales. */
export type SampleMarket = MarketOffer;
export type SampleFixture = FixtureView;

const RHO = -0.03;
const MAX_GOALS = 12;

interface FixtureSeed {
  id: string;
  league: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  lambda: number;
  mu: number;
  matchOdds: [number, number, number];
  offers: { selection: Selection; odds: number }[];
}

const SEEDS: FixtureSeed[] = [
  {
    id: 'betis-girona',
    league: 'La Liga',
    kickoff: '16:15',
    homeTeam: 'Real Betis',
    awayTeam: 'Girona',
    lambda: 1.78,
    mu: 1.12,
    matchOdds: [1.95, 3.4, 3.8],
    offers: [
      { selection: { kind: 'match_result', outcome: 'home' }, odds: 1.95 },
      { selection: { kind: 'total_goals', line: 2.5, side: 'over' }, odds: 1.72 },
      { selection: { kind: 'btts', yes: true }, odds: 1.68 },
      { selection: { kind: 'double_chance', outcome: 'home_draw' }, odds: 1.28 },
      { selection: { kind: 'asian_handicap', team: 'home', line: -1 }, odds: 3.1 },
    ],
  },
  {
    id: 'athletic-osasuna',
    league: 'La Liga',
    kickoff: '18:30',
    homeTeam: 'Athletic Club',
    awayTeam: 'Osasuna',
    lambda: 1.45,
    mu: 0.92,
    matchOdds: [1.8, 3.5, 4.6],
    offers: [
      { selection: { kind: 'match_result', outcome: 'home' }, odds: 1.8 },
      { selection: { kind: 'total_goals', line: 2.5, side: 'under' }, odds: 1.65 },
      { selection: { kind: 'btts', yes: false }, odds: 1.72 },
      { selection: { kind: 'asian_handicap', team: 'home', line: -1 }, odds: 2.9 },
    ],
  },
  {
    id: 'brighton-newcastle',
    league: 'Premier',
    kickoff: '21:00',
    homeTeam: 'Brighton',
    awayTeam: 'Newcastle',
    lambda: 1.68,
    mu: 1.55,
    matchOdds: [2.35, 3.45, 2.95],
    offers: [
      { selection: { kind: 'total_goals', line: 2.5, side: 'over' }, odds: 1.6 },
      { selection: { kind: 'match_result', outcome: 'draw' }, odds: 3.45 },
      { selection: { kind: 'btts', yes: true }, odds: 1.55 },
      { selection: { kind: 'match_result', outcome: 'home' }, odds: 2.35 },
    ],
  },
  {
    id: 'atalanta-bologna',
    league: 'Serie A',
    kickoff: '20:45',
    homeTeam: 'Atalanta',
    awayTeam: 'Bologna',
    lambda: 1.92,
    mu: 1.02,
    matchOdds: [1.75, 3.7, 4.4],
    offers: [
      { selection: { kind: 'match_result', outcome: 'home' }, odds: 1.75 },
      { selection: { kind: 'total_goals', line: 2.5, side: 'over' }, odds: 1.85 },
      { selection: { kind: 'double_chance', outcome: 'home_draw' }, odds: 1.22 },
    ],
  },
];

/**
 * Simula el consenso de varias casas aplicando márgenes distintos a una misma
 * cuota base. Sirve para que el camino de código de `consensusProbabilities`
 * se ejercite igual que con datos reales.
 */
function simulateBooks(odds: number[]): { bookmaker: string; odds: number[] }[] {
  const shades = [
    { bookmaker: 'sharp-a', factor: 1.01 },
    { bookmaker: 'soft-b', factor: 0.985 },
    { bookmaker: 'soft-c', factor: 0.975 },
  ];
  return shades.map(({ bookmaker, factor }) => ({
    bookmaker,
    odds: odds.map((o) => Number((o * factor).toFixed(3))),
  }));
}

function buildFixture(seed: FixtureSeed): SampleFixture {
  const matrix = scoreMatrixFromRates(seed.lambda, seed.mu, RHO, MAX_GOALS);

  // El consenso 1X2 calibra cuánto se desvía el mercado del modelo en este
  // partido; ese mismo desvío se aplica al resto de mercados.
  const consensus = consensusProbabilities(simulateBooks(seed.matchOdds));

  const markets: SampleMarket[] = seed.offers.map((offer, index) => {
    const modelProbability = selectionProbability(matrix, offer.selection);

    // La probabilidad de mercado de cada selección se toma de su propia cuota,
    // descontando un margen típico del 5%.
    const marketProbability = Math.min(0.98, (1 / offer.odds) / 1.05);
    const blendedProbability = blendProbabilities(modelProbability, marketProbability, 0.35);

    return {
      id: `${seed.id}:${index}`,
      selection: offer.selection,
      label: describeSelection(offer.selection),
      odds: offer.odds,
      modelProbability,
      marketProbability,
      blendedProbability,
      edge: edge(blendedProbability, offer.odds),
      expectedValue: expectedValue(blendedProbability, offer.odds),
    };
  });

  const bestEv = markets.reduce((max, m) => Math.max(max, m.expectedValue), -1);

  return {
    id: seed.id,
    league: seed.league,
    kickoff: seed.kickoff,
    homeTeam: seed.homeTeam,
    awayTeam: seed.awayTeam,
    lambda: seed.lambda,
    mu: seed.mu,
    matrix,
    matchOdds: seed.matchOdds,
    markets,
    bestEv,
    modelSplit: {
      home: consensus.probabilities[0]!,
      draw: consensus.probabilities[1]!,
      away: consensus.probabilities[2]!,
    },
  };
}

/** Partidos de muestra, ordenados por el mejor EV disponible. */
export const SAMPLE_FIXTURES: SampleFixture[] = SEEDS.map(buildFixture).sort(
  (a, b) => b.bestEv - a.bestEv,
);

export const SAMPLE_MATRICES: ReadonlyMap<string, number[][]> = new Map(
  SAMPLE_FIXTURES.map((f) => [f.id, f.matrix]),
);

export const SAMPLE_LEAGUES = [...new Set(SAMPLE_FIXTURES.map((f) => f.league))];
