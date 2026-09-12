/**
 * Traduce los mercados de The Odds API a las selecciones del motor.
 *
 * Es el punto donde un proveedor externo se convierte en algo que el motor
 * entiende. Si un resultado no se puede mapear con certeza se descarta: una
 * selección mal interpretada produce una recomendación de apuesta incorrecta,
 * que es mucho peor que una selección de menos.
 */

import type { SelectionInput } from '../../../packages/core/dist/selection.js';

export interface MappedOutcome {
  selection: SelectionInput;
  odds: number;
}

export interface MappableMarket {
  key: string;
  outcomes: { name: string; price: number; point?: number }[];
}

/**
 * `homeTeam` y `awayTeam` son necesarios porque The Odds API identifica los
 * resultados por el nombre del equipo, no por una posición fija.
 */
export function mapMarket(
  market: MappableMarket,
  homeTeam: string,
  awayTeam: string,
): MappedOutcome[] {
  switch (market.key) {
    case 'h2h':
      return mapMatchResult(market, homeTeam, awayTeam);
    case 'totals':
      return mapTotals(market);
    case 'spreads':
      return mapSpreads(market, homeTeam, awayTeam);
    case 'btts':
      return mapBtts(market);
    default:
      // Mercado que aún no soportamos. Se ignora sin ruido: la lista de
      // mercados de la API crece y no todos son relevantes.
      return [];
  }
}

function mapMatchResult(
  market: MappableMarket,
  homeTeam: string,
  awayTeam: string,
): MappedOutcome[] {
  const mapped: MappedOutcome[] = [];

  for (const outcome of market.outcomes) {
    if (!isValidPrice(outcome.price)) continue;

    if (outcome.name === homeTeam) {
      mapped.push({ selection: { kind: 'match_result', outcome: 'home' }, odds: outcome.price });
    } else if (outcome.name === awayTeam) {
      mapped.push({ selection: { kind: 'match_result', outcome: 'away' }, odds: outcome.price });
    } else if (outcome.name.toLowerCase() === 'draw') {
      mapped.push({ selection: { kind: 'match_result', outcome: 'draw' }, odds: outcome.price });
    }
    // Un nombre que no casa con ninguno de los tres se descarta: puede ser un
    // equipo renombrado, y adivinar sería peor que omitirlo.
  }

  return mapped;
}

function mapTotals(market: MappableMarket): MappedOutcome[] {
  const mapped: MappedOutcome[] = [];

  for (const outcome of market.outcomes) {
    if (!isValidPrice(outcome.price)) continue;
    if (outcome.point === undefined || !isSupportedLine(outcome.point)) continue;

    const side = outcome.name.toLowerCase();
    if (side !== 'over' && side !== 'under') continue;

    mapped.push({
      selection: { kind: 'total_goals', line: outcome.point, side },
      odds: outcome.price,
    });
  }

  return mapped;
}

function mapSpreads(
  market: MappableMarket,
  homeTeam: string,
  awayTeam: string,
): MappedOutcome[] {
  const mapped: MappedOutcome[] = [];

  for (const outcome of market.outcomes) {
    if (!isValidPrice(outcome.price)) continue;
    if (outcome.point === undefined || !isSupportedLine(outcome.point)) continue;

    const team =
      outcome.name === homeTeam ? 'home' : outcome.name === awayTeam ? 'away' : null;
    if (!team) continue;

    mapped.push({
      selection: { kind: 'asian_handicap', team, line: outcome.point },
      odds: outcome.price,
    });
  }

  return mapped;
}

function mapBtts(market: MappableMarket): MappedOutcome[] {
  const mapped: MappedOutcome[] = [];

  for (const outcome of market.outcomes) {
    if (!isValidPrice(outcome.price)) continue;

    const name = outcome.name.toLowerCase();
    if (name !== 'yes' && name !== 'no') continue;

    mapped.push({ selection: { kind: 'btts', yes: name === 'yes' }, odds: outcome.price });
  }

  return mapped;
}

function isValidPrice(price: number): boolean {
  return Number.isFinite(price) && price > 1 && price <= 1000;
}

/**
 * El motor trabaja con líneas enteras o de medio punto. Las de cuarto
 * (-0.25, -0.75) reparten el stake en dos apuestas, lo que no es una
 * probabilidad única y exige lógica de liquidación aparte. Hasta que exista, se
 * descartan en vez de tratarlas como si fueran de medio punto.
 */
function isSupportedLine(point: number): boolean {
  return Number.isInteger(point * 2);
}
