/**
 * Cliente de Supabase.
 *
 * La sesión se guarda en SecureStore (Keychain / Keystore), no en
 * AsyncStorage: contiene el refresh token, y en un dispositivo con root o
 * jailbreak AsyncStorage es texto plano.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

const extra = Constants.expoConfig?.extra ?? {};
const supabaseUrl = extra.supabaseUrl as string | undefined;
const supabaseAnonKey = extra.supabaseAnonKey as string | undefined;

/** True cuando hay backend configurado. La UI lo usa para avisar del modo muestra. */
export const isBackendConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isBackendConfigured) {
  // Aviso, no excepción: sin backend la app debe arrancar igualmente en modo
  // datos de muestra. Lanzar aquí la mataría al importar, antes de que ninguna
  // pantalla pueda explicar qué falta.
  console.warn(
    'Faltan EXPO_PUBLIC_SUPABASE_URL o EXPO_PUBLIC_SUPABASE_ANON_KEY.\n' +
      'La app arranca con datos de muestra. Copia apps/mobile/.env.example a .env para conectarla.',
  );
}

/**
 * SecureStore tiene un límite de 2048 bytes por entrada y la sesión puede
 * superarlo, así que la partimos en trozos. La clave índice guarda cuántos hay.
 */
const CHUNK_SIZE = 1800;

const secureStorage: SupportedStorage = {
  async getItem(key) {
    const countRaw = await SecureStore.getItemAsync(`${key}__count`);
    if (countRaw === null) {
      return SecureStore.getItemAsync(key);
    }

    const count = Number.parseInt(countRaw, 10);
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${key}__${i}`);
      // Un trozo perdido deja la sesión corrupta: mejor tratarla como ausente
      // y forzar un login limpio que devolver un JSON a medias.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key, value) {
    await this.removeItem?.(key);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }

    await Promise.all(
      chunks.map((chunk, index) => SecureStore.setItemAsync(`${key}__${index}`, chunk)),
    );
    await SecureStore.setItemAsync(`${key}__count`, String(chunks.length));
  },

  async removeItem(key) {
    const countRaw = await SecureStore.getItemAsync(`${key}__count`);
    if (countRaw !== null) {
      const count = Number.parseInt(countRaw, 10);
      await Promise.all(
        Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${key}__${i}`)),
      );
      await SecureStore.deleteItemAsync(`${key}__count`);
    }
    await SecureStore.deleteItemAsync(key);
  },
};

// SecureStore no existe en web; allí AsyncStorage es lo que hay.
const storage = Platform.OS === 'web' ? AsyncStorage : secureStorage;

/**
 * Sin configuración se crea un cliente apuntando a un host inexistente: las
 * llamadas fallan con un error de red normal, que las pantallas ya manejan, en
 * vez de reventar con `undefined` en mitad de un componente.
 */
export const supabase = createClient(
  supabaseUrl ?? 'https://sin-configurar.invalid',
  supabaseAnonKey ?? 'sin-configurar',
  {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      // En móvil no hay URL que inspeccionar: el deep link lo maneja expo-router.
      detectSessionInUrl: false,
    },
  },
);

/**
 * Supabase sólo refresca el token mientras la app está en primer plano. Sin
 * esto, al volver de segundo plano la sesión puede estar caducada y la primera
 * consulta falla con un 401.
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
