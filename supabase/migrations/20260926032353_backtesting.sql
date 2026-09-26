-- Fase 4: backtesting y calibración de `w`.
--
-- Las cuotas propias sólo existen desde que arrancó la ingesta, así que no dan
-- muestra para calibrar nada. football-data.co.uk publica gratis, por partido,
-- las cuotas previas (recogidas uno a tres días antes) y las de cierre de
-- varias casas, para toda la temporada. Se guardan aparte de `odds_snapshots`
-- a propósito: mezclarlas confundiría a `settle-bets`, que decide el cierre de
-- las apuestas reales a partir de los snapshots propios.

create table public.historical_odds (
  fixture_id   text primary key references public.fixtures(id) on delete cascade,
  source       text not null default 'football-data.co.uk',
  -- { "matchResult": [{ "bookmaker", "odds": [l, x, v] }], "totals25": [...] }
  early        jsonb not null,
  closing      jsonb not null,
  imported_at  timestamptz not null default now()
);

-- Una fila por ejecución del backtest. Se guarda el historial entero para ver
-- cómo evoluciona `w` a medida que crece la muestra, no sólo el último valor.
create table public.model_calibrations (
  id              bigserial primary key,
  -- Peso del modelo que minimiza la log loss en el histórico.
  model_weight    double precision not null check (model_weight between 0 and 1),
  -- Si generate-parlays debe usarlo. Falso cuando la muestra no da para fiarse.
  applied         boolean not null,
  fixtures        integer not null,
  events          integer not null,
  window_from     timestamptz,
  window_to       timestamptz,
  -- Curva de log loss, puntuaciones por mercado y simulación de apuestas.
  metrics         jsonb not null,
  created_at      timestamptz not null default now()
);

create index model_calibrations_created_idx on public.model_calibrations(created_at desc);

alter table public.historical_odds    enable row level security;
alter table public.model_calibrations enable row level security;

-- Las cuotas históricas sólo las leen las funciones (service role). La
-- calibración es pública para los usuarios autenticados: la pantalla que
-- explica cómo le va al modelo la lee tal cual.
create policy "calibraciones legibles" on public.model_calibrations
  for select to authenticated using (true);

-- Lunes de madrugada: football-data.co.uk actualiza tras el fin de semana, y
-- el backtest corre después de la importación, antes del ajuste de las 09:00.
select cron.schedule(
  'wagerwise-ingest-history',
  '0 5 * * 1',
  $$select public.invoke_edge_function('ingest-history')$$
);

select cron.schedule(
  'wagerwise-backtest',
  '30 5 * * 1',
  $$select public.invoke_edge_function('backtest')$$
);
