/**
 * Ajuste del modelo Dixon-Coles por liga, y snapshot diario de tipos de cambio.
 *
 * Lee los partidos ya terminados de la base de datos —no llama a ninguna API
 * externa— así que no consume cuota. Por eso puede correr a diario sin coste.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { fitDixonColes, type HistoricalMatch } from '../../../packages/engine/dist/index.js';
import { fetchFxRates } from '../_shared/providers.ts';
import { trackRun } from '../_shared/quota.ts';

/** Mínimo de partidos para que el ajuste signifique algo. */
const MIN_MATCHES = 40;

/** Ventana de histórico. Dos temporadas dan muestra sin arrastrar plantillas viejas. */
const LOOKBACK_DAYS = 730;

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const finishRun = await trackRun(supabase, 'fit-model');
  const summary = { leagues: [] as string[], skipped: [] as string[], fxRates: 0 };

  try {
    const { data: leagues, error: leaguesError } = await supabase
      .from('leagues')
      .select('id')
      .eq('is_active', true);

    if (leaguesError) throw new Error(`No se pudieron leer ligas: ${leaguesError.message}`);

    for (const league of leagues ?? []) {
      const result = await fitLeague(supabase, league.id as string);
      if (result.ok) summary.leagues.push(league.id as string);
      else summary.skipped.push(`${league.id}: ${result.reason}`);
    }

    summary.fxRates = await refreshFxRates(supabase);

    await finishRun('ok', summary);
    return json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun('failed', { message, summary });
    return json({ error: message, summary }, 500);
  }
});

async function fitLeague(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from('fixtures')
    .select('home_team_id, away_team_id, home_goals, away_goals, kickoff_at')
    .eq('league_id', leagueId)
    .eq('status', 'finished')
    .gte('kickoff_at', since)
    .order('kickoff_at', { ascending: false })
    .limit(2000);

  if (error) return { ok: false, reason: `lectura fallida: ${error.message}` };

  const matches: HistoricalMatch[] = (data ?? [])
    // Un partido marcado como terminado sin marcador es un dato incompleto:
    // incluirlo con 0-0 sesgaría el ataque de ambos equipos a la baja.
    .filter((row) => row.home_goals !== null && row.away_goals !== null)
    .map((row) => ({
      homeTeamId: row.home_team_id as string,
      awayTeamId: row.away_team_id as string,
      homeGoals: row.home_goals as number,
      awayGoals: row.away_goals as number,
      date: new Date(row.kickoff_at as string),
    }));

  if (matches.length < MIN_MATCHES) {
    return { ok: false, reason: `sólo ${matches.length} partidos, mínimo ${MIN_MATCHES}` };
  }

  const model = fitDixonColes(matches, { asOf: new Date() });

  const ratings = [...model.ratings.values()].map((rating) => ({
    league_id: leagueId,
    team_id: rating.teamId,
    attack: rating.attack,
    defence: rating.defence,
    fitted_at: new Date().toISOString(),
  }));

  const { error: ratingsError } = await supabase
    .from('team_ratings')
    .upsert(ratings, { onConflict: 'league_id,team_id' });
  if (ratingsError) return { ok: false, reason: `escritura de ratings: ${ratingsError.message}` };

  const { error: fitError } = await supabase.from('model_fits').upsert(
    {
      league_id: leagueId,
      home_advantage: model.homeAdvantage,
      rho: model.rho,
      base_rate: model.baseRate,
      sample_size: model.sampleSize,
      fitted_at: new Date().toISOString(),
    },
    { onConflict: 'league_id' },
  );
  if (fitError) return { ok: false, reason: `escritura del ajuste: ${fitError.message}` };

  return { ok: true };
}

/**
 * Snapshot diario de tipos de cambio.
 *
 * Sólo se usan para *presentar* importes. El bankroll vive siempre en su moneda
 * de origen y nunca se reconvierte, así que una tasa desactualizada no altera
 * ningún saldo.
 */
async function refreshFxRates(supabase: SupabaseClient): Promise<number> {
  try {
    const rates = await fetchFxRates('COP');
    const wanted = ['USD', 'EUR', 'MXN', 'BRL', 'COP'];

    const rows = wanted
      .filter((code) => rates[code] !== undefined)
      .map((code) => ({
        currency: code,
        rate_to_cop: code === 'COP' ? 1 : 1 / rates[code]!,
        updated_at: new Date().toISOString(),
      }));

    if (rows.length === 0) return 0;

    const { error } = await supabase.from('fx_rates').upsert(rows, { onConflict: 'currency' });
    if (error) throw new Error(error.message);

    return rows.length;
  } catch (error) {
    // Las tasas son secundarias: su fallo no debe tumbar el ajuste del modelo.
    console.error('No se pudieron refrescar los tipos de cambio:', error);
    return 0;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
