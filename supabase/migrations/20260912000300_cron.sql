-- Programación de la ingesta.
--
-- IMPORTANTE: este fichero necesita dos valores propios de tu proyecto antes de
-- aplicarlo. Sustituye:
--   <PROJECT_REF>          el ref de tu proyecto Supabase
--   <SERVICE_ROLE_KEY>     la service role key
--
-- Mejor aún, guárdalos en Vault y léelos desde ahí, para no dejar la clave
-- escrita en una migración versionada:
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

/**
 * Invoca una Edge Function. Lee la URL y la clave desde Vault para que no
 * queden en el cuerpo de los jobs.
 */
create or replace function public.invoke_edge_function(function_name text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  project_url text;
  service_key text;
  request_id bigint;
begin
  select decrypted_secret into project_url
    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into service_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if project_url is null or service_key is null then
    raise exception 'Faltan los secretos project_url o service_role_key en Vault.';
  end if;

  select net.http_post(
    url     := project_url || '/functions/v1/' || function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_edge_function(text) from public, anon, authenticated;

-- ── Programación ─────────────────────────────────────────────
-- Las horas son UTC. Colombia es UTC-5, así que 09:00 UTC = 04:00 local.

-- Modelo y tipos de cambio: una vez al día, antes de que empiece el día local.
select cron.schedule(
  'wagerwise-fit-model',
  '0 9 * * *',
  $$select public.invoke_edge_function('fit-model')$$
);

-- Calendario: tres veces al día. Consume 1 crédito por liga y llamada.
select cron.schedule(
  'wagerwise-ingest-fixtures',
  '0 11,17,23 * * *',
  $$select public.invoke_edge_function('ingest-fixtures')$$
);

-- Cuotas: tres pasadas diarias. Cada una cuesta 2 créditos por liga, así que
-- son unos 360 créditos al mes sobre los 500 del tier gratuito.
select cron.schedule(
  'wagerwise-ingest-odds',
  '30 11,17,23 * * *',
  $$select public.invoke_edge_function('ingest-odds')$$
);

-- Parlays del día y análisis de IA, después de tener cuotas frescas.
select cron.schedule(
  'wagerwise-generate-parlays',
  '0 12 * * *',
  $$select public.invoke_edge_function('generate-parlays')$$
);

-- Para desprogramar:
--   select cron.unschedule('wagerwise-ingest-odds');
-- Para revisar el historial:
--   select * from cron.job_run_details order by start_time desc limit 20;
