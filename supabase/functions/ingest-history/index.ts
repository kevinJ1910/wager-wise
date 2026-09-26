/**
 * Importa las cuotas históricas de football-data.co.uk para el backtesting.
 *
 * Cada fila del CSV se engancha a un partido ya ingerido de football-data.org
 * por liga, fecha (±1 día: el CSV da la fecha local británica) y nombres, y se
 * acepta sólo si el marcador coincide. Esa última comprobación es la que
 * convierte un emparejamiento por nombres —siempre algo frágil— en uno fiable:
 * dos fuentes independientes no se equivocan a la vez con el mismo resultado.
 *
 * Gratis y sin clave: no pasa por el guard de cuota. Corre una vez por semana.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { seasonOf } from '../_shared/football-data.ts';
import { fetchHistoricalSeason, type HistoricalRow } from '../_shared/football-data-uk.ts';
import { LEAGUES, leagueId, type LeagueConfig } from '../_shared/leagues.ts';
import { trackRun } from '../_shared/quota.ts';
import { bestFixtureMatch } from '../../../packages/core/dist/team-names.js';

const DAY = 86_400_000;

interface FixtureRow {
  id: string;
  kickoff_at: string;
  home_goals: number | null;
  away_goals: number | null;
  home: { name: string } | null;
  away: { name: string } | null;
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const finishRun = await trackRun(supabase, 'ingest-history');
  const summary = {
    rows: 0,
    imported: 0,
    unmatched: [] as string[],
    scoreMismatch: [] as string[],
    notes: [] as string[],
  };

  try {
    const season = seasonOf(new Date());

    for (const league of LEAGUES) {
      // La temporada anterior entera más lo que va de la actual: lo mismo que
      // ingiere `ingest-fixtures`, así que todo partido del CSV tiene pareja.
      const rows: HistoricalRow[] = [];
      for (const year of [season - 1, season]) {
        try {
          rows.push(...(await fetchHistoricalSeason(league.historyCode, year)));
        } catch (error) {
          summary.notes.push(`${league.name} ${year}: ${error instanceof Error ? error.message : error}`);
        }
      }
      summary.rows += rows.length;
      if (rows.length === 0) continue;

      const imported = await importLeague(supabase, league, rows, summary);
      summary.imported += imported;
    }

    // Truncado para que el detalle de la ejecución siga siendo legible.
    summary.unmatched = summary.unmatched.slice(0, 30);
    summary.scoreMismatch = summary.scoreMismatch.slice(0, 30);

    await finishRun('ok', summary);
    return json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun('failed', { message, summary });
    return json({ error: message, summary }, 500);
  }
});

async function importLeague(
  supabase: SupabaseClient,
  league: LeagueConfig,
  rows: HistoricalRow[],
  summary: { unmatched: string[]; scoreMismatch: string[] },
): Promise<number> {
  const from = new Date(Math.min(...rows.map((row) => row.date.getTime())) - DAY).toISOString();

  const { data, error } = await supabase
    .from('fixtures')
    .select(
      'id, kickoff_at, home_goals, away_goals, ' +
        'home:teams!fixtures_home_team_id_fkey(name), away:teams!fixtures_away_team_id_fkey(name)',
    )
    .eq('league_id', leagueId(league))
    .eq('status', 'finished')
    .gte('kickoff_at', from)
    .limit(2000);

  if (error) throw new Error(`No se pudieron leer partidos de ${league.name}: ${error.message}`);

  const fixtures = ((data ?? []) as unknown as FixtureRow[]).map((row) => ({
    id: row.id,
    time: new Date(row.kickoff_at).getTime(),
    home: row.home?.name ?? '',
    away: row.away?.name ?? '',
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
  }));

  const records: Record<string, unknown>[] = [];

  for (const row of rows) {
    const day = row.date.getTime();
    const sameDay = fixtures.filter((f) => f.time >= day - DAY && f.time < day + 2 * DAY);
    const fixture = bestFixtureMatch(sameDay, row.home, row.away);
    const label = `${league.name} ${row.date.toISOString().slice(0, 10)} ${row.home}-${row.away}`;

    if (!fixture) {
      summary.unmatched.push(label);
      continue;
    }

    if (fixture.homeGoals !== row.homeGoals || fixture.awayGoals !== row.awayGoals) {
      summary.scoreMismatch.push(
        `${label}: CSV ${row.homeGoals}-${row.awayGoals}, base ${fixture.homeGoals}-${fixture.awayGoals}`,
      );
      continue;
    }

    records.push({
      fixture_id: fixture.id,
      early: row.early,
      closing: row.closing,
      imported_at: new Date().toISOString(),
    });
  }

  // Por lotes: una temporada completa en una sola petición roza el límite de
  // tamaño de cuerpo de PostgREST.
  for (let i = 0; i < records.length; i += 200) {
    const { error: upsertError } = await supabase
      .from('historical_odds')
      .upsert(records.slice(i, i + 200), { onConflict: 'fixture_id' });
    if (upsertError) throw new Error(`No se pudieron guardar cuotas históricas: ${upsertError.message}`);
  }

  return records.length;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
