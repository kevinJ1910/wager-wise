/**
 * Registro único de ligas.
 *
 * Cada fuente nombra la misma liga a su manera —football-data.org con `PD`,
 * The Odds API con `soccer_spain_la_liga`, football-data.co.uk con `SP1`— y
 * antes cada función llevaba su propia lista. Añadir una liga significaba
 * tocar tres sitios y acordarse de los tres. Ahora es una línea aquí.
 *
 * El límite real de cuántas caben lo pone The Odds API (500 créditos/mes en el
 * tier gratuito). Con la cadencia de `ingest-odds` —una pasada diaria por liga
 * con partidos en la semana, más otra el mismo día de partido— cada liga
 * cuesta del orden de 85-90 créditos al mes: cuatro ligas quedan en ~350, con
 * margen para reintentos. Una quinta rozaría el tope.
 *
 * El otro límite es el de football-data.org, 10 peticiones por minuto:
 * `ingest-fixtures` hace dos por liga en cada pasada, ocho con cuatro ligas.
 * A partir de la sexta habría que espaciarlas.
 */

export interface LeagueConfig {
  /** Código de football-data.org; el id interno es `football-data:<code>`. */
  code: string;
  name: string;
  country: string;
  /** Deporte en The Odds API. */
  oddsSportKey: string;
  /** Fichero de football-data.co.uk con las cuotas históricas. */
  historyCode: string;
  /** Etiqueta del chip de onboarding, que es lo que guarda `followed_leagues`. */
  followLabel: string;
}

export const LEAGUES: readonly LeagueConfig[] = [
  { code: 'PD', name: 'La Liga', country: 'España', oddsSportKey: 'soccer_spain_la_liga', historyCode: 'SP1', followLabel: 'La Liga' },
  { code: 'PL', name: 'Premier League', country: 'Inglaterra', oddsSportKey: 'soccer_epl', historyCode: 'E0', followLabel: 'Premier' },
  { code: 'SA', name: 'Serie A', country: 'Italia', oddsSportKey: 'soccer_italy_serie_a', historyCode: 'I1', followLabel: 'Serie A' },
  { code: 'BL1', name: 'Bundesliga', country: 'Alemania', oddsSportKey: 'soccer_germany_bundesliga', historyCode: 'D1', followLabel: 'Bundesliga' },
];

export function leagueId(league: LeagueConfig): string {
  return `football-data:${league.code}`;
}
