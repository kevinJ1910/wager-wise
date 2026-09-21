/**
 * Aviso diario de valor, por push.
 *
 * Manda una notificación sólo cuando hay algo que decir: si el modelo no
 * encuentra ninguna selección por encima del umbral, no se envía nada. Un push
 * diario que a veces dice "hoy no hay nada" entrena al usuario a ignorarlos.
 *
 * Lo que sale del servidor es el token de Expo y una frase sobre fútbol. Ni
 * correo, ni bankroll, ni identificador de usuario: el push no es un canal por
 * el que deban viajar datos personales.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
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
    const best = await bestAlert(supabase);

    if (!best) {
      summary.notes.push('Sin selecciones por encima del umbral; no se envía nada.');
      await finishRun('ok', summary);
      return json(summary);
    }

    summary.alerts = best.count;

    const tokens = await tokensOfSubscribers(supabase);
    summary.recipients = tokens.length;

    if (tokens.length === 0) {
      await finishRun('ok', summary);
      return json(summary);
    }

    const body =
      best.count > 1
        ? `${best.label} · ${best.matchLabel} (EV +${(best.expectedValue * 100).toFixed(1)}%) y ${best.count - 1} más.`
        : `${best.label} · ${best.matchLabel} (EV +${(best.expectedValue * 100).toFixed(1)}%).`;

    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      const result = await push(batch, body);
      summary.sent += result.sent;
      summary.pruned += await pruneDeadTokens(supabase, result.dead);
      if (result.note) summary.notes.push(result.note);
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
  label: string;
  matchLabel: string;
  expectedValue: number;
  count: number;
}

async function bestAlert(supabase: SupabaseClient): Promise<Alert | null> {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_HOURS * 3_600_000);

  const { data, error } = await supabase
    .from('model_predictions')
    .select(
      `selection, expected_value,
       fixtures!inner(
         kickoff_at, status,
         home:teams!fixtures_home_team_id_fkey(name),
         away:teams!fixtures_away_team_id_fkey(name)
       )`,
    )
    .gte('expected_value', MIN_EXPECTED_VALUE)
    .eq('fixtures.status', 'scheduled')
    .gte('fixtures.kickoff_at', now.toISOString())
    .lte('fixtures.kickoff_at', horizon.toISOString())
    .order('expected_value', { ascending: false })
    .limit(40);

  if (error) throw new Error(`No se pudieron leer las alertas: ${error.message}`);
  if (!data || data.length === 0) return null;

  const rows = data as unknown as {
    selection: Record<string, unknown>;
    expected_value: number;
    fixtures: { home: { name: string }; away: { name: string } };
  }[];

  const top = rows[0]!;

  return {
    label: describe(top.selection),
    matchLabel: `${top.fixtures.home.name} vs ${top.fixtures.away.name}`,
    expectedValue: top.expected_value,
    count: rows.length,
  };
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

async function tokensOfSubscribers(supabase: SupabaseClient): Promise<string[]> {
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id')
    .eq('settings->>alerts', 'true');

  if (profilesError) throw new Error(`No se pudieron leer los perfiles: ${profilesError.message}`);

  const ids = (profiles ?? []).map((row) => row.id as string);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('notification_tokens')
    .select('token')
    .in('user_id', ids);

  if (error) throw new Error(`No se pudieron leer los tokens: ${error.message}`);

  return [...new Set((data ?? []).map((row) => row.token as string))];
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
