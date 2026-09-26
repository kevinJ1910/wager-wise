import { describe, expect, it } from 'vitest';
import { bestFixtureMatch, normalizeTeamName, teamNameScore } from './team-names.js';

/** Nombres tal como los guarda football-data.org, que es la referencia interna. */
const INTERNAL = [
  'FC Barcelona',
  'RCD Espanyol de Barcelona',
  'Club Atlético de Madrid',
  'Real Madrid CF',
  'Athletic Club',
  'Real Sociedad de Fútbol',
  'RC Deportivo La Coruña',
  'Manchester United FC',
  'Manchester City FC',
  'Nottingham Forest FC',
  'Wolverhampton Wanderers FC',
  'Brighton & Hove Albion FC',
  'FC Internazionale Milano',
  'AC Milan',
  'Hellas Verona FC',
  'Bologna FC 1909',
  'FC Bayern München',
  'Borussia Mönchengladbach',
  'Eintracht Frankfurt',
  '1. FC Köln',
  'Hamburger SV',
  'TSG 1899 Hoffenheim',
];

/** Cómo llaman a cada uno football-data.co.uk y The Odds API. */
const EXTERNAL: [string, string][] = [
  ['Barcelona', 'FC Barcelona'],
  ['Espanol', 'RCD Espanyol de Barcelona'],
  ['Ath Madrid', 'Club Atlético de Madrid'],
  ['Atlético Madrid', 'Club Atlético de Madrid'],
  ['Ath Bilbao', 'Athletic Club'],
  ['Athletic Bilbao', 'Athletic Club'],
  ['Sociedad', 'Real Sociedad de Fútbol'],
  ['La Coruna', 'RC Deportivo La Coruña'],
  ['Man United', 'Manchester United FC'],
  ['Man City', 'Manchester City FC'],
  ["Nott'm Forest", 'Nottingham Forest FC'],
  ['Wolves', 'Wolverhampton Wanderers FC'],
  ['Brighton and Hove Albion', 'Brighton & Hove Albion FC'],
  ['Inter', 'FC Internazionale Milano'],
  ['Inter Milan', 'FC Internazionale Milano'],
  ['Milan', 'AC Milan'],
  ['Verona', 'Hellas Verona FC'],
  ['Bologna', 'Bologna FC 1909'],
  ['Bayern Munich', 'FC Bayern München'],
  ["M'gladbach", 'Borussia Mönchengladbach'],
  ['Borussia Monchengladbach', 'Borussia Mönchengladbach'],
  ['Ein Frankfurt', 'Eintracht Frankfurt'],
  ['FC Koln', '1. FC Köln'],
  ['Hamburg', 'Hamburger SV'],
  ['Hoffenheim', 'TSG 1899 Hoffenheim'],
];

/** El mejor candidato interno para un nombre externo, o null si hay empate. */
function resolve(external: string): string | null {
  const scored = INTERNAL.map((name) => ({ name, score: teamNameScore(name, external) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0]!.score === scored[1]!.score) return null;
  return scored[0]!.name;
}

describe('teamNameScore', () => {
  it.each(EXTERNAL)('%s → %s sin ambigüedad', (external, internal) => {
    expect(resolve(external)).toBe(internal);
  });

  it('prefiere el nombre exacto al contenido: Milan es el AC Milan, no el Inter', () => {
    expect(teamNameScore('AC Milan', 'Milan')).toBe(2);
    expect(teamNameScore('FC Internazionale Milano', 'Milan')).toBe(1);
  });

  it('Barcelona es el Barça, no el Espanyol', () => {
    expect(teamNameScore('FC Barcelona', 'Barcelona')).toBe(2);
    expect(teamNameScore('RCD Espanyol de Barcelona', 'Barcelona')).toBe(1);
  });

  it('dos equipos distintos no casan', () => {
    expect(teamNameScore('Real Madrid CF', 'Ath Madrid')).toBe(0);
    expect(teamNameScore('Manchester City FC', 'Man United')).toBe(0);
  });

  it('ignora acentos, siglas y números', () => {
    expect(normalizeTeamName('1. FC Köln')).toBe('koln');
    expect(normalizeTeamName('TSG 1899 Hoffenheim')).toBe('hoffenheim');
  });

  it('un nombre vacío no casa con nada', () => {
    expect(teamNameScore('', 'FC Barcelona')).toBe(0);
  });
});

describe('bestFixtureMatch', () => {
  const saturday = [
    { id: 'derbi', home: 'FC Internazionale Milano', away: 'AC Milan' },
    { id: 'otro', home: 'AC Milan', away: 'FC Internazionale Milano' },
  ];

  it('distingue local y visitante en un derbi', () => {
    expect(bestFixtureMatch(saturday, 'Inter', 'Milan')?.id).toBe('derbi');
    expect(bestFixtureMatch(saturday, 'Milan', 'Inter')?.id).toBe('otro');
  });

  it('exige que casen los dos equipos', () => {
    expect(bestFixtureMatch(saturday, 'Inter', 'Juventus')).toBeNull();
  });

  it('ante un empate no asigna nada', () => {
    const twins = [
      { id: 'a', home: 'Real Madrid CF', away: 'FC Barcelona' },
      { id: 'b', home: 'Real Madrid CF', away: 'FC Barcelona' },
    ];
    expect(bestFixtureMatch(twins, 'Real Madrid', 'Barcelona')).toBeNull();
  });
});
