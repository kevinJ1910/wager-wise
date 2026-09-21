-- Endurecer las dos funciones de trigger.
--
-- El linter de Supabase las señaló al revisar la Fase 3. Son anteriores, pero
-- el problema es real: al vivir en el esquema `public`, PostgREST las expone
-- como RPC, así que cualquiera con sesión podía invocar
-- `/rest/v1/rpc/handle_new_user` — una función `security definer`. Como trigger
-- sin `NEW` fallaría, pero no hay ninguna razón para que sea invocable.
--
-- Y `touch_updated_at` corría con el `search_path` del llamante: un esquema
-- suyo por delante de `public` puede cambiar a qué resuelve un nombre dentro
-- de la función.

alter function public.touch_updated_at() set search_path = public;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;

-- Los triggers siguen funcionando: los ejecuta el propietario de la tabla, no
-- el rol que hace el insert.
