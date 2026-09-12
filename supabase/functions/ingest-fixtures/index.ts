/**
 * Ingesta de partidos: ligas, equipos, calendario de las próximas 48 horas y
 * resultados recientes (para ajustar el modelo).
 *
 * Usa football-data.org en vez de API-Football: su tier gratuito da acceso
 * completo a la temporada en curso (partidos jugados y por jugar) en las 12
 * competiciones que cubre, entre ellas La Liga y Premier League — lo
 * contrario de API-Football, cuyo plan free bloquea la temporada actual y
 * sólo permite consultar 2022-2024. Al venir todo del mismo proveedor, el
 * calendario próximo y el histórico de ajuste comparten el mismo espacio de
 * ids de liga y equipo, sin necesidad de mapear nombres entre proveedores.
 *
 * Se invoca por `pg_cron`. Todo el gasto pasa por el guard de cuota.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  fetchMatches,
  mapMatchStatus,
  type FootballDataMatch,
} from '../_shared/football-data.ts';
import { QuotaExceededError, reserveQuota, trackRun } from '../_shared/quota.ts';

/** Ligas de la Fase 1. Los códigos son los de football-data.org. */
const LEAGUES = [
  { code: 'PD', name: 'La Liga', country: 'España' },
  { code: 'PL', name: 'Premier League', country: 'Inglaterra' },
];

const DAYS_AHEAD = 2;
/** Ventana histórica para alimentar el ajuste de Dixon-Coles. */
const HISTORY_DAYS_BACK = 120;

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const apiKey = Deno.env.get('FOOTBALL_DATA_API_KEY');
  if (!apiKey) {
    return json({ error: 'Falta FOOTBALL_DATA_API_KEY en los secretos de la función.' }, 500);
  }

  const dailyLimit = Number(Deno.env.get('FOOTBALL_DATA_DAILY_LIMIT') ?? '500');
  const finishRun = await trackRun(supabase, 'ingest-fixtures');

  const summary = { leagues: 0, teams: 0, fixtures: 0, skipped: [] as string[] };

  try {
    const today = new Date();
    const upcomingFrom = isoDate(today);
    const upcomingTo = isoDate(new Date(today.getTime() + DAYS_AHEAD * 86_400_000));
    const historyFrom = isoDate(new Date(today.getTime() - HISTORY_DAYS_BACK * 86_400_000));
    // football-data.org excluye el día de hoy de "histórico" implícitamente:
    // basta con pedir hasta hoy y quedarnos con lo ya jugado.
    const historyTo = upcomingFrom;

    for (const league of LEAGUES) {
      // Una llamada cubre ambas ventanas de una vez: pedimos el rango
      // completo (histórico + próximos) y clasificamos por estado nosotros
      // mismos, así gastamos 1 petición de cuota por liga en vez de 2.
      let onCall: (endpoint: string, statusCode: number) => Promise<void>;

      try {
        onCall = await reserveQuota(supabase, 'football-data', 1, dailyLimit);
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          // Paramos limpio: lo ingerido hasta aquí es válido y queda guardado.
          summary.skipped.push(`${league.name}: ${error.message}`);
          break;
        }
        throw error;
      }

      const matches = await fetchMatches(league.code, historyFrom, upcomingTo, {
        apiKey,
        onCall,
      });

      await upsertLeague(supabase, league);
      summary.leagues += 1;

      const teams = collectTeams(matches, league.code);
      if (teams.length > 0) {
        const { error } = await supabase.from('teams').upsert(teams, { onConflict: 'id' });
        if (error) throw new Error(`No se pudieron guardar equipos: ${error.message}`);
        summary.teams += teams.length;
      }

      const rows = matches.map((item) => ({
        id: `football-data:${item.id}`,
        league_id: `football-data:${league.code}`,
        home_team_id: `football-data:${item.homeTeam.id}`,
        away_team_id: `football-data:${item.awayTeam.id}`,
        kickoff_at: item.utcDate,
        status: mapMatchStatus(item.status),
        home_goals: item.score.fullTime.home,
        away_goals: item.score.fullTime.away,
        matchday: item.matchday ?? null,
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
  supabase: SupabaseClient,
  league: (typeof LEAGUES)[number],
): Promise<void> {
  const { error } = await supabase.from('leagues').upsert(
    {
      id: `football-data:${league.code}`,
      name: league.name,
      country: league.country,
      season: new Date().getUTCFullYear(),
      is_active: true,
    },
    { onConflict: 'id' },
  );
  if (error) throw new Error(`No se pudo guardar la liga ${league.name}: ${error.message}`);
}

/** Equipos únicos de la respuesta; un mismo equipo aparece en varios partidos. */
function collectTeams(matches: FootballDataMatch[], leagueCode: string) {
  const byId = new Map<number, { id: string; name: string; league_id: string; logo_url: string | null }>();

  for (const item of matches) {
    for (const team of [item.homeTeam, item.awayTeam]) {
      if (byId.has(team.id)) continue;
      byId.set(team.id, {
        id: `football-data:${team.id}`,
        name: team.name,
        league_id: `football-data:${leagueCode}`,
        logo_url: team.crest ?? null,
      });
    }
  }

  return [...byId.values()];
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
