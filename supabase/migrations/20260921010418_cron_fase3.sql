-- Programación de la Fase 3.
--
-- Ninguno de estos dos jobs llama a una API de pago, así que no tocan el
-- presupuesto de cuota: `settle-bets` sólo lee la base, y el push de Expo es
-- gratuito.

-- Liquidación: cada tres horas. Los partidos europeos terminan a lo largo de
-- toda la tarde y noche, y una pasada diaria dejaría al usuario mirando una
-- apuesta "abierta" que hace horas que se decidió.
select cron.schedule(
  'wagerwise-settle-bets',
  '15 */3 * * *',
  $$select public.invoke_edge_function('settle-bets')$$
);

-- Alertas de valor: una vez al día, después de generar los parlays (12:00 UTC).
select cron.schedule(
  'wagerwise-send-alerts',
  '30 12 * * *',
  $$select public.invoke_edge_function('send-alerts')$$
);

-- Para desprogramar:
--   select cron.unschedule('wagerwise-settle-bets');
