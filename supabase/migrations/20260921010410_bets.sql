-- Fase 3 · seguimiento de apuestas.
--
-- Tres cosas:
--   1. Las columnas que faltaban para liquidar y para medir CLV.
--   2. `place_parlay`, que registra parlay + legs + movimiento en una sola
--      transacción. Desde el cliente eran tres viajes sin transacción: un fallo
--      a mitad dejaba un parlay huérfano sin legs, es decir, una apuesta con
--      stake y sin nada a lo que apostar.
--   3. La política que faltaba para poder re-registrar un token de push.

-- ─────────────────────────────────────────────────────────────
-- Columnas de liquidación y CLV
-- ─────────────────────────────────────────────────────────────

-- Cuota de cierre de la selección: el mejor precio del mercado justo antes del
-- saque. Es la referencia contra la que se mide si el usuario cogió valor, y se
-- guarda por leg porque el mercado se mueve distinto en cada una.
alter table public.user_parlay_legs
  add column if not exists closing_odds double precision,
  add column if not exists settled_at   timestamptz;

-- CLV del parlay entero: combinada tomada contra combinada de cierre. Nulo
-- mientras a alguna leg le falte el cierre; un CLV a medias no es un CLV.
alter table public.user_parlays
  add column if not exists clv double precision;

-- Liquidar es "dame las legs abiertas de partidos ya terminados".
create index if not exists user_parlay_legs_open_idx
  on public.user_parlay_legs(fixture_id)
  where status = 'open';

-- El ledger del bankroll. Es el rastro auditable del dinero —y la base para
-- depósitos y retiradas más adelante—; las estadísticas de la pantalla Apuestas
-- salen de `user_parlays`, que es donde vive el estado. Un número, una fuente.
alter table public.bankroll_transactions
  drop constraint if exists bankroll_transactions_kind_check;

alter table public.bankroll_transactions
  add constraint bankroll_transactions_kind_check
  check (kind in ('deposit', 'withdrawal', 'stake', 'settlement'));

-- ─────────────────────────────────────────────────────────────
-- Registrar un parlay, atómicamente
-- ─────────────────────────────────────────────────────────────

/**
 * Inserta el parlay, sus legs y el apunte de stake en una transacción.
 *
 * `security invoker` a propósito: las políticas RLS siguen aplicando, así que
 * la función no puede escribir en la cuenta de otro ni aunque se la llame con
 * un `user_id` inventado — de hecho ni lo acepta, lo toma de `auth.uid()`.
 */
create or replace function public.place_parlay(
  p_stake            numeric,
  p_currency         text,
  p_combined_odds    double precision,
  p_true_probability double precision,
  p_expected_value   double precision,
  p_legs             jsonb,
  p_title            text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_parlay_id uuid;
  v_leg      jsonb;
  v_position smallint := 0;
begin
  if v_user_id is null then
    raise exception 'Hay que iniciar sesión para registrar una apuesta.';
  end if;

  if jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) < 1 then
    raise exception 'Un parlay necesita al menos una selección.';
  end if;

  insert into public.user_parlays (
    user_id, title, stake, currency, combined_odds, true_probability, expected_value
  )
  values (
    v_user_id, p_title, p_stake, p_currency, p_combined_odds, p_true_probability, p_expected_value
  )
  returning id into v_parlay_id;

  for v_leg in select * from jsonb_array_elements(p_legs)
  loop
    insert into public.user_parlay_legs (
      user_parlay_id, fixture_id, selection, odds, probability, position
    )
    values (
      v_parlay_id,
      v_leg ->> 'fixture_id',
      v_leg -> 'selection',
      (v_leg ->> 'odds')::double precision,
      nullif(v_leg ->> 'probability', '')::double precision,
      v_position
    );
    v_position := v_position + 1;
  end loop;

  -- El stake sale del bankroll en el momento de registrar; la liquidación
  -- devuelve el retorno bruto. Los dos apuntes juntos dan el resultado neto.
  insert into public.bankroll_transactions (user_id, amount, kind, parlay_id, note)
  values (v_user_id, -p_stake, 'stake', v_parlay_id, p_title);

  return v_parlay_id;
end;
$$;

revoke all on function public.place_parlay(
  numeric, text, double precision, double precision, double precision, jsonb, text
) from public, anon;

grant execute on function public.place_parlay(
  numeric, text, double precision, double precision, double precision, jsonb, text
) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Push: volver a registrar el mismo token
-- ─────────────────────────────────────────────────────────────

-- Expo devuelve el mismo token en cada arranque. Sin política de update el
-- upsert fallaba contra la unique (user_id, token) en vez de refrescar la fila.
drop policy if exists "tokens propios: actualizar" on public.notification_tokens;
create policy "tokens propios: actualizar" on public.notification_tokens
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
