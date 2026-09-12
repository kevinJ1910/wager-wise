/**
 * Ingesta de partidos: ligas, equipos y calendario de las próximas 48 horas,
 * más los resultados recientes que alimentan el modelo.
 *
 * Se invoca por `pg_cron`. Todo el gasto pasa por el guard de cuota.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  fetchFixtures,
  mapFixtureStatus,
  type ApiFootballFixture,
} from '../_shared/providers.ts';
import { QuotaExceededError, reserveQuota, trackRun } from '../_shared/quota.ts';

/** Ligas de la Fase 1. Los ids son los de API-Football. */
const LEAGUES = [
  { id: 140, name: 'La Liga', country: 'España', season: 2026 },
  { id: 39, name: 'Premier League', country: 'Inglaterra', season: 2026 },
];

const DAYS_AHEAD = 2;

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const apiKey = Deno.env.get('API_FOOTBALL_KEY');
  if (!apiKey) {
    return json({ error: 'Falta API_FOOTBALL_KEY en los secretos de la función.' }, 500);
  }

  const dailyLimit = Number(Deno.env.get('API_FOOTBALL_DAILY_LIMIT') ?? '100');
  const finishRun = await trackRun(supabase, 'ingest-fixtures');

  const summary = { leagues: 0, teams: 0, fixtures: 0, skipped: [] as string[] };

  try {
    const today = new Date();
    const from = isoDate(today);
    const to = isoDate(new Date(today.getTime() + DAYS_AHEAD * 86_400_000));

    for (const league of LEAGUES) {
      let onCall: (endpoint: string, statusCode: number) => Promise<void>;

      try {
        onCall = await reserveQuota(supabase, 'api-football', 1, dailyLimit);
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          // Paramos limpio: lo ingerido hasta aquí es válido y queda guardado.
          summary.skipped.push(`${league.name}: ${error.message}`);
          break;
        }
        throw error;
      }

      const fixtures = await fetchFixtures(league.id, league.season, from, to, {
        apiKey,
        onCall,
      });

      await upsertLeague(supabase, league);
      summary.leagues += 1;

      const teams = collectTeams(fixtures, league.id);
      if (teams.length > 0) {
        const { error } = await supabase.from('teams').upsert(teams, { onConflict: 'id' });
        if (error) throw new Error(`No se pudieron guardar equipos: ${error.message}`);
        summary.teams += teams.length;
      }

      const rows = fixtures.map((item) => ({
        id: `api-football:${item.fixture.id}`,
        league_id: `api-football:${league.id}`,
        home_team_id: `api-football:${item.teams.home.id}`,
        away_team_id: `api-football:${item.teams.away.id}`,
        kickoff_at: item.fixture.date,
        status: mapFixtureStatus(item.fixture.status.short),
        home_goals: item.goals.home,
        away_goals: item.goals.away,
        matchday: parseMatchday(item.league.round),
        updated_at: new Date().toISOString(),
      }));

      if (rows.length > 0) {
        const { error } = await supabase.from('fixtures').upsert(rows, { onConflict: 'id' });
        if (error) throw new Error(`No se pudieron guardar partidos: ${error.message}`);
        summary.fixtures += rows.length;
      }
    }

    await finishRun('ok', summary);
    return json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun('failed', { message, summary });
    return json({ error: message, summary }, 500);
  }
});

async function upsertLeague(
  supabase: ReturnType<typeof createClient>,
  league: (typeof LEAGUES)[number],
): Promise<void> {
  const { error } = await supabase.from('leagues').upsert(
    {
      id: `api-football:${league.id}`,
      name: league.name,
      country: league.country,
      season: league.season,
      is_active: true,
    },
    { onConflict: 'id' },
  );
  if (error) throw new Error(`No se pudo guardar la liga ${league.name}: ${error.message}`);
}

/** Equipos únicos de la respuesta; un mismo equipo aparece en varios partidos. */
function collectTeams(fixtures: ApiFootballFixture[], leagueId: number) {
  const byId = new Map<number, { id: string; name: string; league_id: string; logo_url: string | null }>();

  for (const item of fixtures) {
    for (const team of [item.teams.home, item.teams.away]) {
      if (byId.has(team.id)) continue;
      byId.set(team.id, {
        id: `api-football:${team.id}`,
        name: team.name,
        league_id: `api-football:${leagueId}`,
        logo_url: team.logo ?? null,
      });
    }
  }

  return [...byId.values()];
}

/** "Regular Season - 6" → 6. Devuelve null si no hay número reconocible. */
function parseMatchday(round: string | null | undefined): number | null {
  if (!round) return null;
  const match = /(\d+)\s*$/.exec(round);
  return match ? Number(match[1]) : null;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
