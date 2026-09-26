-- WagerWise · esquema inicial
--
-- Tres grupos de tablas:
--   referencia  — datos deportivos públicos, lectura para cualquier autenticado
--   derivadas   — salidas del motor y de la IA, lectura para cualquier autenticado
--   del usuario — bankroll, parlays e historial, aisladas por RLS
--
-- Sólo las Edge Functions (service role) escriben en referencia y derivadas.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- Referencia
-- ─────────────────────────────────────────────────────────────

create table public.leagues (
  id            text primary key,               -- 'football-data:PD'
  name          text not null,
  country       text,
  season        integer not null,
  logo_url      text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.teams (
  id            text primary key,               -- 'football-data:558'
  name          text not null,
  short_name    text,
  league_id     text references public.leagues(id) on delete set null,
  logo_url      text,
  created_at    timestamptz not null default now()
);

create index teams_league_idx on public.teams(league_id);

create type public.fixture_status as enum ('scheduled', 'live', 'finished', 'postponed', 'cancelled');

create table public.fixtures (
  id             text primary key,              -- 'football-data:564634'
  league_id      text not null references public.leagues(id) on delete cascade,
  home_team_id   text not null references public.teams(id),
  away_team_id   text not null references public.teams(id),
  kickoff_at     timestamptz not null,
  status         public.fixture_status not null default 'scheduled',
  home_goals     smallint,
  away_goals     smallint,
  matchday       smallint,
  updated_at     timestamptz not null default now(),
  constraint fixtures_distinct_teams check (home_team_id <> away_team_id)
);

create index fixtures_kickoff_idx on public.fixtures(kickoff_at);
create index fixtures_league_kickoff_idx on public.fixtures(league_id, kickoff_at);
-- Para el ajuste del modelo: partidos terminados con marcador.
create index fixtures_finished_idx on public.fixtures(league_id, kickoff_at)
  where status = 'finished';

create table public.bookmakers (
  id           text primary key,
  name         text not null,
  is_sharp     boolean not null default false
);

-- Snapshot de cuotas. Serie temporal: nunca se actualiza una fila, se inserta
-- otra. Eso es lo que permite medir movimiento de línea y CLV.
create table public.odds_snapshots (
  id                bigserial primary key,
  fixture_id        text not null references public.fixtures(id) on delete cascade,
  bookmaker_id      text not null references public.bookmakers(id),
  market_kind       text not null,              -- 'match_result' | 'total_goals' | ...
  market_params     jsonb not null default '{}'::jsonb,   -- { "line": 2.5 }
  outcomes          jsonb not null,             -- [{ "selection": {...}, "odds": 1.95 }]
  captured_at       timestamptz not null default now(),
  is_closing        boolean not null default false
);

create index odds_fixture_captured_idx on public.odds_snapshots(fixture_id, captured_at desc);
create unique index odds_closing_unique_idx
  on public.odds_snapshots(fixture_id, bookmaker_id, market_kind, market_params)
  where is_closing;

-- ─────────────────────────────────────────────────────────────
-- Derivadas: salida del motor
-- ─────────────────────────────────────────────────────────────

create table public.team_ratings (
  league_id    text not null references public.leagues(id) on delete cascade,
  team_id      text not null references public.teams(id) on delete cascade,
  attack       double precision not null,
  defence      double precision not null,
  fitted_at    timestamptz not null default now(),
  primary key (league_id, team_id)
);

create table public.model_fits (
  league_id        text primary key references public.leagues(id) on delete cascade,
  home_advantage   double precision not null,
  rho              double precision not null,
  base_rate        double precision not null,
  sample_size      integer not null,
  fitted_at        timestamptz not null default now()
);

-- Probabilidades por selección, ya mezcladas modelo + mercado.
create table public.model_predictions (
  id                 bigserial primary key,
  fixture_id         text not null references public.fixtures(id) on delete cascade,
  selection          jsonb not null,
  model_probability  double precision not null,
  market_probability double precision not null,
  blended_probability double precision not null,
  best_odds          double precision,
  best_bookmaker_id  text references public.bookmakers(id),
  edge               double precision,
  expected_value     double precision,
  computed_at        timestamptz not null default now(),
  constraint model_predictions_prob_range check (
    blended_probability between 0 and 1
    and model_probability between 0 and 1
    and market_probability between 0 and 1
  )
);

create index model_predictions_fixture_idx on public.model_predictions(fixture_id);
create index model_predictions_ev_idx on public.model_predictions(expected_value desc)
  where expected_value > 0;

create type public.parlay_tier as enum ('safe', 'balanced', 'aggressive');

create table public.parlay_recommendations (
  id                  uuid primary key default gen_random_uuid(),
  tier                public.parlay_tier not null,
  for_date            date not null,
  combined_odds       double precision not null,
  true_probability    double precision not null,
  naive_probability   double precision not null,
  expected_value      double precision not null,
  any_push_probability double precision not null default 0,
  created_at          timestamptz not null default now()
);

create index parlay_recommendations_date_idx on public.parlay_recommendations(for_date, tier);

create table public.parlay_legs (
  id              uuid primary key default gen_random_uuid(),
  parlay_id       uuid not null references public.parlay_recommendations(id) on delete cascade,
  fixture_id      text not null references public.fixtures(id) on delete cascade,
  selection       jsonb not null,
  odds            double precision not null,
  probability     double precision not null,
  bookmaker_id    text references public.bookmakers(id),
  position        smallint not null
);

create index parlay_legs_parlay_idx on public.parlay_legs(parlay_id, position);

-- Explicaciones de la IA. Separadas del cálculo a propósito: si Gemini falla o
-- se apaga, las recomendaciones siguen existiendo sin su texto.
create table public.ai_analyses (
  id             uuid primary key default gen_random_uuid(),
  fixture_id     text references public.fixtures(id) on delete cascade,
  selection      jsonb,
  reasoning      text not null,
  facts          jsonb not null default '[]'::jsonb,
  confidence     smallint check (confidence between 0 and 100),
  veto           boolean not null default false,
  veto_reason    text,
  model          text not null,
  created_at     timestamptz not null default now()
);

create index ai_analyses_fixture_idx on public.ai_analyses(fixture_id);

create table public.fx_rates (
  currency     text primary key,
  rate_to_cop  double precision not null,
  updated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Operación
-- ─────────────────────────────────────────────────────────────

create table public.api_usage_log (
  id           bigserial primary key,
  provider     text not null,                   -- 'api-football' | 'the-odds-api' | 'gemini'
  endpoint     text not null,
  cost         integer not null default 1,      -- créditos consumidos
  status_code  integer,
  called_at    timestamptz not null default now()
);

create index api_usage_provider_day_idx on public.api_usage_log(provider, called_at desc);

create table public.ingestion_runs (
  id           bigserial primary key,
  job          text not null,
  status       text not null,                   -- 'running' | 'ok' | 'failed'
  detail       jsonb,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- Usuario
-- ─────────────────────────────────────────────────────────────

create type public.risk_profile as enum ('conservative', 'balanced', 'aggressive');

create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  display_name      text,
  -- El bankroll se guarda SIEMPRE en la moneda elegida. La conversión es sólo
  -- de presentación: nunca se recalcula el histórico al cambiar de moneda.
  currency          text not null default 'COP',
  bankroll          numeric(14,2) not null default 1200000,
  risk_profile      public.risk_profile not null default 'balanced',
  followed_leagues  text[] not null default '{}',
  is_adult          boolean not null default false,
  onboarded_at      timestamptz,
  settings          jsonb not null default
    '{"alerts":true,"correlationAudit":true,"stakeLimit":true,"theme":"system"}'::jsonb,
  weekly_limit_pct  double precision not null default 0.15,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profiles_bankroll_positive check (bankroll >= 0)
);

create type public.bet_status as enum ('open', 'won', 'lost', 'void');

create table public.user_parlays (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  title          text,
  stake          numeric(14,2) not null,
  currency       text not null,
  combined_odds  double precision not null,
  true_probability double precision,
  expected_value double precision,
  status         public.bet_status not null default 'open',
  payout         numeric(14,2),
  source_parlay_id uuid references public.parlay_recommendations(id) on delete set null,
  placed_at      timestamptz not null default now(),
  settled_at     timestamptz,
  constraint user_parlays_stake_positive check (stake > 0)
);

create index user_parlays_user_idx on public.user_parlays(user_id, placed_at desc);

create table public.user_parlay_legs (
  id             uuid primary key default gen_random_uuid(),
  user_parlay_id uuid not null references public.user_parlays(id) on delete cascade,
  fixture_id     text not null references public.fixtures(id),
  selection      jsonb not null,
  odds           double precision not null,
  probability    double precision,
  status         public.bet_status not null default 'open',
  position       smallint not null
);

create index user_parlay_legs_parent_idx on public.user_parlay_legs(user_parlay_id, position);

create table public.bankroll_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      numeric(14,2) not null,
  kind        text not null,                    -- 'deposit' | 'withdrawal' | 'settlement'
  parlay_id   uuid references public.user_parlays(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

create index bankroll_transactions_user_idx on public.bankroll_transactions(user_id, created_at desc);

create table public.notification_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token       text not null,
  platform    text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, token)
);

-- ─────────────────────────────────────────────────────────────
-- Crear el perfil automáticamente al registrarse
-- ─────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
