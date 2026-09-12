-- Row Level Security.
--
-- Regla: RLS activo en TODAS las tablas. Las de referencia y derivadas son de
-- sólo lectura para autenticados; las del usuario, sólo para su dueño. Las
-- Edge Functions usan service role, que salta RLS por diseño.
--
-- Nada tiene política de escritura para `authenticated`: un cliente no puede
-- inventarse una cuota ni una recomendación.

alter table public.leagues                enable row level security;
alter table public.teams                  enable row level security;
alter table public.fixtures               enable row level security;
alter table public.bookmakers             enable row level security;
alter table public.odds_snapshots         enable row level security;
alter table public.team_ratings           enable row level security;
alter table public.model_fits             enable row level security;
alter table public.model_predictions      enable row level security;
alter table public.parlay_recommendations enable row level security;
alter table public.parlay_legs            enable row level security;
alter table public.ai_analyses            enable row level security;
alter table public.fx_rates               enable row level security;
alter table public.api_usage_log          enable row level security;
alter table public.ingestion_runs         enable row level security;
alter table public.profiles               enable row level security;
alter table public.user_parlays           enable row level security;
alter table public.user_parlay_legs       enable row level security;
alter table public.bankroll_transactions  enable row level security;
alter table public.notification_tokens    enable row level security;

-- ── Referencia y derivadas: lectura para autenticados ────────

create policy "leagues legibles" on public.leagues
  for select to authenticated using (true);

create policy "teams legibles" on public.teams
  for select to authenticated using (true);

create policy "fixtures legibles" on public.fixtures
  for select to authenticated using (true);

create policy "bookmakers legibles" on public.bookmakers
  for select to authenticated using (true);

create policy "odds legibles" on public.odds_snapshots
  for select to authenticated using (true);

create policy "ratings legibles" on public.team_ratings
  for select to authenticated using (true);

create policy "fits legibles" on public.model_fits
  for select to authenticated using (true);

create policy "predicciones legibles" on public.model_predictions
  for select to authenticated using (true);

create policy "parlays recomendados legibles" on public.parlay_recommendations
  for select to authenticated using (true);

create policy "legs recomendadas legibles" on public.parlay_legs
  for select to authenticated using (true);

create policy "analisis ia legibles" on public.ai_analyses
  for select to authenticated using (true);

create policy "fx legibles" on public.fx_rates
  for select to authenticated using (true);

-- api_usage_log e ingestion_runs quedan sin política: sólo service role.

-- ── Usuario: aislamiento por auth.uid() ──────────────────────

create policy "perfil propio: leer" on public.profiles
  for select to authenticated using (auth.uid() = id);

create policy "perfil propio: actualizar" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "perfil propio: insertar" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

create policy "parlays propios: leer" on public.user_parlays
  for select to authenticated using (auth.uid() = user_id);

create policy "parlays propios: insertar" on public.user_parlays
  for insert to authenticated with check (auth.uid() = user_id);

create policy "parlays propios: actualizar" on public.user_parlays
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "parlays propios: borrar" on public.user_parlays
  for delete to authenticated using (auth.uid() = user_id);

-- Las legs heredan la propiedad del parlay padre.
create policy "legs propias: leer" on public.user_parlay_legs
  for select to authenticated using (
    exists (
      select 1 from public.user_parlays p
      where p.id = user_parlay_legs.user_parlay_id and p.user_id = auth.uid()
    )
  );

create policy "legs propias: insertar" on public.user_parlay_legs
  for insert to authenticated with check (
    exists (
      select 1 from public.user_parlays p
      where p.id = user_parlay_legs.user_parlay_id and p.user_id = auth.uid()
    )
  );

create policy "legs propias: actualizar" on public.user_parlay_legs
  for update to authenticated using (
    exists (
      select 1 from public.user_parlays p
      where p.id = user_parlay_legs.user_parlay_id and p.user_id = auth.uid()
    )
  );

create policy "legs propias: borrar" on public.user_parlay_legs
  for delete to authenticated using (
    exists (
      select 1 from public.user_parlays p
      where p.id = user_parlay_legs.user_parlay_id and p.user_id = auth.uid()
    )
  );

create policy "movimientos propios: leer" on public.bankroll_transactions
  for select to authenticated using (auth.uid() = user_id);

create policy "movimientos propios: insertar" on public.bankroll_transactions
  for insert to authenticated with check (auth.uid() = user_id);

create policy "tokens propios: leer" on public.notification_tokens
  for select to authenticated using (auth.uid() = user_id);

create policy "tokens propios: insertar" on public.notification_tokens
  for insert to authenticated with check (auth.uid() = user_id);

create policy "tokens propios: borrar" on public.notification_tokens
  for delete to authenticated using (auth.uid() = user_id);
