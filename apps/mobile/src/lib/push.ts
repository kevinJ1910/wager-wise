/**
 * Notificaciones push.
 *
 * El registro es best-effort a propósito: un permiso denegado, un emulador o
 * Expo Go —que desde SDK 53 ya no entrega push remoto— no son errores que deban
 * interrumpir nada. La app funciona igual sin notificaciones; son aditivas,
 * como la capa de IA.
 *
 * El token viaja a `notification_tokens` y de ahí a la función `send-alerts`.
 * Lo único que sale hacia el servicio de Expo es ese token y una frase sobre
 * fútbol: ni correo, ni bankroll, ni historial.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase.js';

export type PushResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'unsupported' | 'denied' | 'error'; detail?: string };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Pide permiso, obtiene el token de Expo y lo guarda.
 *
 * Idempotente: Expo devuelve el mismo token en cada arranque y el upsert lo
 * refresca en vez de acumular filas.
 */
export async function registerPushToken(): Promise<PushResult> {
  if (!Device.isDevice) {
    return { ok: false, reason: 'unsupported', detail: 'Los emuladores no reciben push remoto.' };
  }

  // Sin projectId, `getExpoPushTokenAsync` no sabe a qué proyecto asociar el
  // token. Llega con el build de EAS; en Expo Go puede no existir.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  if (!projectId) {
    return {
      ok: false,
      reason: 'unsupported',
      detail: 'Falta el projectId de EAS; el push necesita un development build.',
    };
  }

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Alertas de valor',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    const status =
      existing.status === 'granted'
        ? existing.status
        : (await Notifications.requestPermissionsAsync()).status;

    if (status !== 'granted') return { ok: false, reason: 'denied' };

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return { ok: false, reason: 'error', detail: 'Sin sesión.' };

    const { error } = await supabase
      .from('notification_tokens')
      .upsert(
        { user_id: auth.user.id, token, platform: Platform.OS },
        { onConflict: 'user_id,token' },
      );

    if (error) return { ok: false, reason: 'error', detail: error.message };

    return { ok: true, token };
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Borra el token de este dispositivo. Se llama al apagar las alertas. */
export async function unregisterPushToken(): Promise<void> {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('notification_tokens').delete().eq('token', token);
  } catch {
    // Si ni siquiera podemos obtener el token, no hay nada que borrar.
  }
}
