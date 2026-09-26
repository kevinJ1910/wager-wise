/**
 * Emparejamiento de nombres de equipo entre proveedores.
 *
 * football-data.org dice "FC Internazionale Milano", The Odds API "Inter
 * Milan" y football-data.co.uk "Inter". Con dos ligas bastaba comparar por
 * inclusión; con Serie A y Bundesliga —cinco partidos a la misma hora un
 * sábado— hace falta algo que distinga, y que prefiera la coincidencia exacta
 * a la parcial: "Milan" está contenido en "Internazionale Milano", pero es el
 * nombre exacto del AC Milan.
 *
 * Vive en `core` y no en las Edge Functions para poder cubrirlo con tests: lo
 * usan `ingest-odds` a diario e `ingest-history` cada semana.
 *
 * Nunca decide solo: quien lo usa acota antes por liga y fecha, y
 * `ingest-history` además comprueba que el marcador coincida.
 */

/** Siglas y palabras de relleno que cada fuente pone o quita a su gusto. */
const NOISE = new RegExp(
  '\\b(' +
    [
      'fc', 'cf', 'afc', 'ac', 'acf', 'as', 'ss', 'ssc', 'us', 'bc', 'cfc', 'sc', 'sv', 'fsv',
      'vfb', 'vfl', 'tsg', 'rb', 'rc', 'rcd', 'ud', 'cd', 'ca', 'club', 'de', 'del', 'and',
      'calcio', 'futbol', 'football',
    ].join('|') +
    ')\\b',
  'g',
);

/** Abreviaturas que no se resuelven por inclusión. Clave y valor ya normalizados. */
const ALIASES: Record<string, string> = {
  manunited: 'manchesterunited',
  mancity: 'manchestercity',
  nottmforest: 'nottinghamforest',
  wolves: 'wolverhampton',
  spurs: 'tottenham',
  athbilbao: 'athletic',
  athleticbilbao: 'athletic',
  athmadrid: 'atleticomadrid',
  espanol: 'espanyol',
  inter: 'internazionale',
  intermilan: 'internazionale',
  bayernmunich: 'bayernmunchen',
  einfrankfurt: 'eintrachtfrankfurt',
  mgladbach: 'monchengladbach',
  borussiamgladbach: 'monchengladbach',
};

export function normalizeTeamName(name: string): string {
  const flat = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/[0-9]/g, '')
    .replace(/\s+/g, '');

  return ALIASES[flat] ?? flat;
}

/**
 * 2 = mismo nombre, 1 = uno contiene al otro, 0 = distintos.
 *
 * La puntuación, y no un sí/no, es lo que permite elegir entre dos candidatos
 * que casan a medias.
 */
export function teamNameScore(a: string, b: string): 0 | 1 | 2 {
  const x = normalizeTeamName(a);
  const y = normalizeTeamName(b);
  if (x.length === 0 || y.length === 0) return 0;
  if (x === y) return 2;
  return x.includes(y) || y.includes(x) ? 1 : 0;
}

/**
 * El candidato cuyo local y visitante casan mejor, o null si ninguno casa en
 * ambos lados o si dos empatan: ante la duda no se asigna, porque unas cuotas
 * pegadas al partido equivocado son un error silencioso.
 */
export function bestFixtureMatch<T extends { home: string; away: string }>(
  candidates: readonly T[],
  home: string,
  away: string,
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  let tied = false;

  for (const candidate of candidates) {
    const h = teamNameScore(candidate.home, home);
    const a = teamNameScore(candidate.away, away);
    if (h === 0 || a === 0) continue;

    const score = h + a;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }

  return tied ? null : best;
}
