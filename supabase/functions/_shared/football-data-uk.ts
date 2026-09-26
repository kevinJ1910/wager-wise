/**
 * Lector de los CSV de football-data.co.uk.
 *
 * Es la única fuente gratuita con cuotas históricas por partido de varias
 * casas, y trae dos juegos: las previas, recogidas uno a tres días antes del
 * partido —el momento en que la app decide—, y las de cierre. Sin ellas el
 * backtesting tendría que esperar meses a que la ingesta propia acumulara
 * muestra.
 *
 * Las columnas cambian de una temporada a otra (Pinnacle desaparece en
 * 2026/27, entra Betfair Exchange), así que las casas se descubren por la
 * cabecera en vez de fijarse en una lista: una casa es cualquier prefijo con
 * sus tres columnas H/D/A. Las agregadas (`Max`, `Avg`) se descartan: no son
 * una casa, y promediarlas con las demás contaría dos veces los mismos precios.
 */

import type { MarketQuotes } from '../../../packages/engine/dist/index.js';

const BASE = 'https://www.football-data.co.uk/mmz4281';

export interface HistoricalRow {
  /** Fecha del partido, a medianoche UTC. El CSV da hora local británica. */
  date: Date;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  early: MarketQuotes;
  closing: MarketQuotes;
}

/** Código de temporada del fichero: la 2025/26 es `2526`. */
export function seasonCode(startYear: number): string {
  const two = (year: number) => String(year % 100).padStart(2, '0');
  return `${two(startYear)}${two(startYear + 1)}`;
}

export async function fetchHistoricalSeason(
  divisionCode: string,
  startYear: number,
): Promise<HistoricalRow[]> {
  const url = `${BASE}/${seasonCode(startYear)}/${divisionCode}.csv`;
  const response = await fetch(url, { headers: { Accept: 'text/csv' } });

  // Temporada que todavía no ha empezado: el fichero no existe aún.
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`football-data.co.uk ${url} respondió ${response.status}.`);
  }

  return parseHistoricalCsv(await response.text());
}

const AGGREGATES = /^(Max|Avg)/;

export function parseHistoricalCsv(text: string): HistoricalRow[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0]!.split(',').map((h) => h.trim());
  const column = new Map(header.map((name, index) => [name, index]));

  for (const required of ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG']) {
    if (!column.has(required)) {
      // Fallar alto: un cambio de formato no puede convertirse en cero filas
      // importadas sin que nadie se entere.
      throw new Error(`Formato inesperado de football-data.co.uk: falta la columna ${required}.`);
    }
  }

  const books = discoverBooks(header);
  const rows: HistoricalRow[] = [];

  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const cell = (name: string): string => cells[column.get(name) ?? -1]?.trim() ?? '';
    const number = (name: string): number => Number.parseFloat(cell(name));

    const date = parseDate(cell('Date'));
    const homeGoals = Number.parseInt(cell('FTHG'), 10);
    const awayGoals = Number.parseInt(cell('FTAG'), 10);
    // Filas de partidos aplazados o sin jugar: vienen sin marcador.
    if (!date || Number.isNaN(homeGoals) || Number.isNaN(awayGoals)) continue;

    const quotes = (bases: string[], suffixes: string[]) =>
      bases
        .map((base) => ({
          bookmaker: base.replace(/C$/, ''),
          odds: suffixes.map((suffix) => number(`${base}${suffix}`)),
        }))
        .filter((quote) => quote.odds.every((odds) => Number.isFinite(odds) && odds > 1));

    rows.push({
      date,
      home: cell('HomeTeam'),
      away: cell('AwayTeam'),
      homeGoals,
      awayGoals,
      early: {
        matchResult: quotes(books.matchResult.early, ['H', 'D', 'A']),
        totals25: quotes(books.totals25.early, ['>2.5', '<2.5']),
      },
      closing: {
        matchResult: quotes(books.matchResult.closing, ['H', 'D', 'A']),
        totals25: quotes(books.totals25.closing, ['>2.5', '<2.5']),
      },
    });
  }

  return rows;
}

/**
 * Prefijos de casa por mercado, separando previas de cierre.
 *
 * Una columna de cierre es la previa con una `C` intercalada (`B365H` →
 * `B365CH`, `P>2.5` → `PC>2.5`). La comprobación de que exista la previa evita
 * confundir con un cierre a una casa cuyo nombre ya acaba en C.
 */
function discoverBooks(header: string[]) {
  const names = new Set(header);

  const split = (bases: string[], sibling: (base: string) => string) => {
    const early: string[] = [];
    const closing: string[] = [];
    for (const base of bases) {
      if (AGGREGATES.test(base)) continue;
      const isClosing = base.endsWith('C') && names.has(sibling(base.slice(0, -1)));
      (isClosing ? closing : early).push(base);
    }
    return { early, closing };
  };

  const resultBases = header
    .filter((name) => name.endsWith('H'))
    .map((name) => name.slice(0, -1))
    .filter((base) => base.length > 0 && names.has(`${base}D`) && names.has(`${base}A`));

  const totalsBases = header
    .filter((name) => name.endsWith('>2.5'))
    .map((name) => name.slice(0, -'>2.5'.length))
    .filter((base) => names.has(`${base}<2.5`));

  return {
    matchResult: split(resultBases, (base) => `${base}H`),
    totals25: split(totalsBases, (base) => `${base}>2.5`),
  };
}

/** `dd/mm/yyyy` o, en temporadas antiguas, `dd/mm/yy`. */
function parseDate(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const fullYear = year!.length === 2 ? 2000 + Number(year) : Number(year);
  return new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
}
