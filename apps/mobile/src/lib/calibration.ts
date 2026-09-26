/**
 * Última calibración del modelo, para la pantalla que explica cómo le va.
 *
 * Se lee la última fila, aplicada o no: si el backtest decidió no aplicarla por
 * falta de muestra, el usuario también tiene derecho a ver eso.
 */

import { useQuery } from '@tanstack/react-query';
import { calibrationSchema, type Calibration } from '@wagerwise/core';
import { useAuth } from './auth.js';
import { isBackendConfigured, supabase } from './supabase.js';

export function useCalibration() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  return useQuery({
    // Con el usuario en la clave: una lectura sin sesión devuelve cero filas por
    // RLS, y ese vacío no puede quedarse en caché después de iniciar sesión.
    queryKey: ['calibration', 'latest', userId],
    enabled: isBackendConfigured && userId !== null,
    // Cambia una vez por semana; no hace falta volver a pedirla en cada foco.
    staleTime: 60 * 60 * 1000,
    queryFn: fetchLatestCalibration,
  });
}

async function fetchLatestCalibration(): Promise<Calibration | null> {
  const { data, error } = await supabase
    .from('model_calibrations')
    .select('id, model_weight, applied, fixtures, events, window_from, window_to, created_at, metrics')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`No se pudo leer la calibración: ${error.message}`);
  if (!data) return null;

  const parsed = calibrationSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `La calibración guardada tiene un formato que la app no entiende (${parsed.error.issues[0]?.path.join('.') ?? '?'}).`,
    );
  }

  return parsed.data;
}
