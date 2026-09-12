/**
 * Ingesta de cuotas.
 *
 * Cada ejecución inserta un snapshot nuevo en vez de actualizar el anterior:
 * la serie temporal es lo que permite medir el movimiento de línea y, más
 * adelante, el CLV frente a la línea de cierre.
 *
 * Presupuesto: coste = mercados × regiones. Con 2 mercados y 1 región son 2
 * créditos por llamada, unos 360 al mes con tres pasadas diarias sobre dos
 * ligas — dentro de los 500 del tier gratuito.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { mapMarket } from '../_shared/market-mapping.ts';
import { fetchOdds, oddsCallCost, type OddsEvent } from '../_shared/providers.ts';
import { QuotaExceededError, reserveQuota, trackRun } from '../_shared/quota.ts';

const COMPETITIONS = [
  { sportKey: 'soccer_spain_la_liga', leagueId: 'api-football:140' },
  { sportKey: 'soccer_epl', leagueId: 'api-football:39' },
];

/** Corto a propósito: cada mercado extra multiplica el coste en créditos. */
const MARKETS = ['h2h', 'totals'];
const REGIONS = 'eu';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const apiKey = Deno.env.get('ODDS_API_KEY');
  if (!apiKey) return json({ error: 'Falta ODDS_API_KEY en los secretos.' }, 500);

  const monthlyLimit = Number(Deno.env.get('ODDS_API_MONTHLY_LIMIT') ?? '500');
  const finishRun = await trackRun(supabase, 'ingest-odds');

  const summary = { events: 0, snapshots: 0, unmatched: [] as string[], skipped: [] as string[] };

  try {
    const cost = oddsCallCost(MARKETS, REGIONS);

    for (const competition of COMPETITIONS) {
      let onCall: (endpoint: string, statusCode: number) => Promise<void>;

      try {
        onCall = await reserveQuota(supabase, 'the-odds-api', cost, monthlyLimit);
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          summary.skipped.push(`${competition.sportKey}: ${error.message}`);
          break;
        }
        throw error;
      }

      const events = await fetchOdds(competition.sportKey, MARKETS, { apiKey, onCall }, REGIONS);
      summary.events += events.length;

      for (const event of events) {
        const fixtureId = await resolveFixture(supabase, competition.leagueId, event);

        if (!fixtureId) {
          // Los nombres de equipo difieren entre proveedores. Registrarlo es
          // importante: un partido sin emparejar es valor que no se detecta.
          summary.unmatched.push(`${event.home_team} vs ${event.away_team}`);
          continue;
        }

        const snapshots = buildSnapshots(fixtureId, event);
        if (snapshots.length === 0) continue;

        await upsertBookmakers(supabase, event);

        const { error } = await supabase.from('odds_snapshots').insert(snapshots);
        if (error) throw new Error(`No se pudieron guardar cuotas: ${error.message}`);
        summary.snapshots += snapshots.length;
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

/**
 * Empareja un evento de The Odds API con un partido ya ingerido.
 *
 * El emparejamiento va por hora de inicio (±3h) más similitud de nombres. No
 * se acepta una coincidencia dudosa: asignar cuotas al partido equivocado es
 * un fallo silencioso que acaba en una recomendación errónea.
 */
async function resolveFixture(
  supabase: SupabaseClient,
  leagueId: string,
  event: OddsEvent,
): Promise<string | null> {
  const kickoff = new Date(event.commence_time);
  const windowStart = new Date(kickoff.getTime() - 3 * 3_600_000).toISOString();
  const windowEnd = new Date(kickoff.getTime() + 3 * 3_600_000).toISOString();

  const { data, error } = await supabase
    .from('fixtures')
    .select('id, home_team_id, away_team_id, teams!fixtures_home_team_id_fkey(name)')
    .eq('league_id', leagueId)
    .gte('kickoff_at', windowStart)
    .lte('kickoff_at', windowEnd);

  if (error || !data || data.length === 0) return null;

  // Con un único candidato en la ventana de ±3h dentro de la misma liga, la
  // coincidencia es inequívoca sin comparar nombres.
  if (data.length === 1) return data[0]!.id as string;

  const { data: named } = await supabase
    .from('fixtures')
    .select('id, home:teams!fixtures_home_team_id_fkey(name), away:teams!fixtures_away_team_id_fkey(name)')
    .eq('league_id', leagueId)
    .gte('kickoff_at', windowStart)
    .lte('kickoff_at', windowEnd);

  for (const row of named ?? []) {
    const home = (row as Record<string, { name?: string }>).home?.name ?? '';
    const away = (row as Record<string, { name?: string }>).away?.name ?? '';
    if (similar(home, event.home_team) && similar(away, event.away_team)) {
      return (row as { id: string }).id;
    }
  }

  return null;
}

/** Comparación laxa de nombres: ignora acentos, mayúsculas y sufijos como "FC". */
function similar(a: string, b: string): boolean {
  const normalize = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\b(fc|cf|afc|ud|cd|club|de|futbol|football)\b/g, '')
      .replace(/[^a-z0-9]/g, '');

  const x = normalize(a);
  const y = normalize(b);
  if (x.length === 0 || y.length === 0) return false;

  return x === y || x.includes(y) || y.includes(x);
}

function buildSnapshots(fixtureId: string, event: OddsEvent) {
  const capturedAt = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];

  for (const bookmaker of event.bookmakers) {
    for (const market of bookmaker.markets) {
      const outcomes = mapMarket(market, event.home_team, event.away_team);
      if (outcomes.length === 0) continue;

      // Los totales llegan mezclados con varias líneas; se agrupan por línea
      // para que cada snapshot represente un mercado completo y cerrado.
      const byParams = new Map<string, typeof outcomes>();
      for (const outcome of outcomes) {
        const key = paramsKey(outcome.selection);
        const bucket = byParams.get(key);
        if (bucket) bucket.push(outcome);
        else byParams.set(key, [outcome]);
      }

      for (const [key, group] of byParams) {
        rows.push({
          fixture_id: fixtureId,
          bookmaker_id: bookmaker.key,
          market_kind: group[0]!.selection.kind,
          market_params: JSON.parse(key),
          outcomes: group.map((o) => ({ selection: o.selection, odds: o.odds })),
          captured_at: capturedAt,
        });
      }
    }
  }

  return rows;
}

function paramsKey(selection: { kind: string; line?: number; team?: string }): string {
  const params: Record<string, unknown> = {};
  if (selection.line !== undefined) params.line = selection.line;
  if (selection.team !== undefined) params.team = selection.team;
  return JSON.stringify(params);
}

async function upsertBookmakers(supabase: SupabaseClient, event: OddsEvent): Promise<void> {
  const rows = event.bookmakers.map((b) => ({
    id: b.key,
    name: b.title,
    // Pinnacle es la referencia "sharp": margen bajo y línea que mueve al resto.
    is_sharp: ['pinnacle', 'betfair_ex_eu'].includes(b.key),
  }));

  if (rows.length === 0) return;
  const { error } = await supabase.from('bookmakers').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`No se pudieron guardar casas: ${error.message}`);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
