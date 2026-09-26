/**
 * Ingesta de partidos: ligas, equipos, calendario próximo y el histórico que
 * alimenta el ajuste del modelo.
 *
 * Usa football-data.org en vez de API-Football: su tier gratuito da acceso
 * completo a la temporada en curso (partidos jugados y por jugar) en las 12
 * competiciones que cubre, entre ellas las cuatro que sigue la app — lo
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
  fetchSeason,
  mapMatchStatus,
  seasonOf,
  type FootballDataMatch,
} from '../_shared/football-data.ts';
import { LEAGUES, type LeagueConfig } from '../_shared/leagues.ts';
import { QuotaExceededError, reserveQuota, trackRun } from '../_shared/quota.ts';

/**
 * Ventana de calendario futuro.
 *
 * Tiene que cubrir dos horizontes distintos. El de The Odds API, que ofrece
 * cuotas con ~una semana de antelación: si el calendario sólo llegase a 48
 * horas, esas cuotas no tendrían partido al que engancharse y los créditos
 * gastados en pedirlas se perderían. Y el de los parones de selecciones, que
 * dejan hasta tres semanas sin fútbol de clubes: con una ventana corta la app
 * se queda sin nada real que enseñar justo durante ese hueco.
 *
 * Ampliarla no cuesta nada: es la misma llamada con otro `dateTo`.
 */
const DAYS_AHEAD = 21;
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

    for (const league of LEAGUES) {
      // Una sola petición cubre histórico reciente y calendario próximo:
      // pedimos el rango entero y clasificamos por estado nosotros mismos.
      let onCall: (endpoint: string, statusCode: number) => Promise<void>;

      try {
        // Dos llamadas: la ventana en curso y la temporada anterior completa.
        onCall = await reserveQuota(supabase, 'football-data', 2, dailyLimit);
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          // Paramos limpio: lo ingerido hasta aquí es válido y queda guardado.
          summary.skipped.push(`${league.name}: ${error.message}`);
          break;
        }
        throw error;
      }

      // La temporada anterior entera es lo que da muestra suficiente al ajuste:
      // treinta y ocho partidos por equipo en vez de los ocho o nueve que se
      // llevan jugados en septiembre.
      const [current, previous] = await Promise.all([
        fetchMatches(league.code, historyFrom, upcomingTo, { apiKey, onCall }),
        fetchSeason(league.code, seasonOf(today) - 1, { apiKey, onCall }),
      ]);

      const matches = dedupe([...previous, ...current]);

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
  league: LeagueConfig,
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

/**
 * Un partido por id.
 *
 * Las dos ventanas se solapan en los bordes de temporada; el último en llegar
 * gana porque viene de la consulta más reciente.
 */
function dedupe(matches: FootballDataMatch[]): FootballDataMatch[] {
  const byId = new Map<number, FootballDataMatch>();
  for (const match of matches) byId.set(match.id, match);
  return [...byId.values()];
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
