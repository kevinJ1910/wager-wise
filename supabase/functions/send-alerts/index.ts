/**
 * Aviso diario de valor, por push.
 *
 * Manda una notificación sólo cuando hay algo que decir: si el modelo no
 * encuentra ninguna selección por encima del umbral, no se envía nada. Un push
 * diario que a veces dice "hoy no hay nada" entrena al usuario a ignorarlos.
 *
 * Cada usuario recibe la mejor selección de las ligas que sigue —es lo que
 * promete el onboarding— y nada si en sus ligas no hay valor ese día. Quien no
 * marcó ninguna liga recibe la mejor de todas.
 *
 * Lo que sale del servidor es el token de Expo y una frase sobre fútbol. Ni
 * correo, ni bankroll, ni identificador de usuario: el push no es un canal por
 * el que deban viajar datos personales.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { LEAGUES, leagueId } from '../_shared/leagues.ts';
import { trackRun } from '../_shared/quota.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Umbral de aviso: el mismo 5% que el diseño promete en Perfil. */
const MIN_EXPECTED_VALUE = 0.05;

/** Horizonte del aviso. Más allá de un día, la cuota habrá cambiado. */
const HORIZON_HOURS = 30;

/** Expo acepta hasta 100 mensajes por petición. */
const BATCH_SIZE = 100;

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const finishRun = await trackRun(supabase, 'send-alerts');
  const summary = { alerts: 0, recipients: 0, sent: 0, pruned: 0, notes: [] as string[] };

  try {
    const alerts = await valueAlerts(supabase);
    summary.alerts = alerts.length;

    if (alerts.length === 0) {
      summary.notes.push('Sin selecciones por encima del umbral; no se envía nada.');
      await finishRun('ok', summary);
      return json(summary);
    }

    const subscribers = await fetchSubscribers(supabase);
    summary.recipients = subscribers.length;

    // Agrupados por mensaje: todos los que siguen las mismas ligas reciben el
    // mismo texto, y así se aprovechan los lotes de cien de Expo.
    const byBody = new Map<string, string[]>();
    for (const subscriber of subscribers) {
      const body = messageFor(alerts, subscriber.leagues);
      if (!body) continue;
      const bucket = byBody.get(body) ?? [];
      bucket.push(...subscriber.tokens);
      byBody.set(body, bucket);
    }

    for (const [body, tokens] of byBody) {
      const unique = [...new Set(tokens)];
      for (let i = 0; i < unique.length; i += BATCH_SIZE) {
        const batch = unique.slice(i, i + BATCH_SIZE);
        const result = await push(batch, body);
        summary.sent += result.sent;
        summary.pruned += await pruneDeadTokens(supabase, result.dead);
        if (result.note) summary.notes.push(result.note);
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

// ─────────────────────────────────────────────────────────────
// Qué avisar
// ─────────────────────────────────────────────────────────────

interface Alert {
  leagueId: string;
  label: string;
  matchLabel: string;
  expectedValue: number;
}

/** Selecciones por encima del umbral, de mayor a menor EV. */
async function valueAlerts(supabase: SupabaseClient): Promise<Alert[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_HOURS * 3_600_000);

  const { data, error } = await supabase
    .from('model_predictions')
    .select(
      `selection, expected_value,
       fixtures!inner(
         league_id, kickoff_at, status,
         home:teams!fixtures_home_team_id_fkey(name),
         away:teams!fixtures_away_team_id_fkey(name)
       )`,
    )
    .gte('expected_value', MIN_EXPECTED_VALUE)
    .eq('fixtures.status', 'scheduled')
    .gte('fixtures.kickoff_at', now.toISOString())
    .lte('fixtures.kickoff_at', horizon.toISOString())
    .order('expected_value', { ascending: false })
    .limit(100);

  if (error) throw new Error(`No se pudieron leer las alertas: ${error.message}`);

  const rows = (data ?? []) as unknown as {
    selection: Record<string, unknown>;
    expected_value: number;
    fixtures: { league_id: string; home: { name: string }; away: { name: string } };
  }[];

  return rows.map((row) => ({
    leagueId: row.fixtures.league_id,
    label: describe(row.selection),
    matchLabel: `${row.fixtures.home.name} vs ${row.fixtures.away.name}`,
    expectedValue: row.expected_value,
  }));
}

/**
 * El texto para un usuario, o null si sus ligas no tienen nada hoy.
 *
 * `null` en `leagues` es que no eligió ninguna, no que no quiera ninguna —quien
 * no quiere alertas lo dice con el interruptor de Perfil— y recibe la mejor de
 * todas. Un conjunto vacío es otra cosa: sólo sigue ligas que la app todavía
 * no cubre, y mandarle una de La Liga rompería lo que se le prometió.
 */
function messageFor(alerts: Alert[], leagues: Set<string> | null): string | null {
  const relevant = leagues === null ? alerts : alerts.filter((a) => leagues.has(a.leagueId));
  const top = relevant[0];
  if (!top) return null;

  const headline = `${top.label} · ${top.matchLabel} (EV +${(top.expectedValue * 100).toFixed(1)}%)`;
  return relevant.length > 1 ? `${headline} y ${relevant.length - 1} más.` : `${headline}.`;
}

/**
 * Etiqueta corta de la selección.
 *
 * Duplica lo justo de `describeSelection` para no arrastrar el motor entero a
 * esta función: aquí sólo hace falta el titular del push.
 */
function describe(selection: Record<string, unknown>): string {
  switch (selection.kind) {
    case 'match_result':
      return { home: 'Gana el local', draw: 'Empate', away: 'Gana el visitante' }[
        String(selection.outcome)
      ] ?? 'Selección';
    case 'total_goals':
      return `${selection.side === 'over' ? 'Más' : 'Menos'} de ${selection.line} goles`;
    case 'btts':
      return selection.yes ? 'Ambos marcan' : 'No marcan ambos';
    case 'double_chance':
      return 'Doble oportunidad';
    case 'asian_handicap':
      return `Hándicap ${selection.line}`;
    default:
      return 'Selección de valor';
  }
}

// ─────────────────────────────────────────────────────────────
// A quién
// ─────────────────────────────────────────────────────────────

/** Etiqueta del onboarding → id de liga. Las que aún no tienen datos se ignoran. */
const LEAGUE_BY_LABEL = new Map(LEAGUES.map((league) => [league.followLabel, leagueId(league)]));

async function fetchSubscribers(
  supabase: SupabaseClient,
): Promise<{ leagues: Set<string> | null; tokens: string[] }[]> {
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, followed_leagues')
    .eq('settings->>alerts', 'true');

  if (profilesError) throw new Error(`No se pudieron leer los perfiles: ${profilesError.message}`);
  if (!profiles || profiles.length === 0) return [];

  const { data, error } = await supabase
    .from('notification_tokens')
    .select('user_id, token')
    .in('user_id', profiles.map((row) => row.id as string));

  if (error) throw new Error(`No se pudieron leer los tokens: ${error.message}`);

  const tokensByUser = new Map<string, string[]>();
  for (const row of data ?? []) {
    const bucket = tokensByUser.get(row.user_id as string) ?? [];
    bucket.push(row.token as string);
    tokensByUser.set(row.user_id as string, bucket);
  }

  return profiles
    .map((profile) => {
      const labels = (profile.followed_leagues as string[] | null) ?? [];
      return {
        leagues:
          labels.length === 0
            ? null
            : new Set(
                labels
                  .map((label) => LEAGUE_BY_LABEL.get(label))
                  .filter((id): id is string => id !== undefined),
              ),
        tokens: tokensByUser.get(profile.id as string) ?? [],
      };
    })
    .filter((subscriber) => subscriber.tokens.length > 0);
}

// ─────────────────────────────────────────────────────────────
// Envío
// ─────────────────────────────────────────────────────────────

async function push(
  tokens: string[],
  body: string,
): Promise<{ sent: number; dead: string[]; note?: string }> {
  const messages = tokens.map((to) => ({
    to,
    title: 'Valor detectado',
    body,
    sound: 'default',
    // Abre directamente la pantalla de alertas al tocar la notificación.
    data: { screen: 'alerts' },
  }));

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    return { sent: 0, dead: [], note: `Expo respondió ${response.status}.` };
  }

  const payload = (await response.json()) as {
    data?: { status: string; details?: { error?: string } }[];
  };

  const dead: string[] = [];
  let sent = 0;

  (payload.data ?? []).forEach((ticket, index) => {
    if (ticket.status === 'ok') {
      sent += 1;
      return;
    }
    // El dispositivo desinstaló la app o revocó el permiso: el token no va a
    // volver a funcionar nunca, así que se borra en vez de reintentarlo a diario.
    if (ticket.details?.error === 'DeviceNotRegistered') {
      const token = tokens[index];
      if (token) dead.push(token);
    }
  });

  return { sent, dead };
}

async function pruneDeadTokens(supabase: SupabaseClient, tokens: string[]): Promise<number> {
  if (tokens.length === 0) return 0;

  const { error } = await supabase.from('notification_tokens').delete().in('token', tokens);
  return error ? 0 : tokens.length;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
