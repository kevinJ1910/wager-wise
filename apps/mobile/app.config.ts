import type { ExpoConfig } from 'expo/config';

/**
 * Configuración de la app.
 *
 * `scheme` es necesario para el retorno del OAuth de Google y para los deep
 * links de recuperación de contraseña.
 */
const config: ExpoConfig = {
  name: 'WagerWise',
  slug: 'wagerwise',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'wagerwise',
  userInterfaceStyle: 'automatic',

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.wagerwise.app',
    infoPlist: {
      // Requisito de tienda para contenido de apuestas.
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: 'com.wagerwise.app',
    adaptiveIcon: { backgroundColor: '#C15F3C' },
  },

  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store',
    'expo-web-browser',
    'expo-status-bar',
    // Las notificaciones sólo llegan en un development build: Expo Go dejó de
    // entregar push remoto en SDK 53. El plugin se declara igual para que el
    // primer build de EAS ya salga configurado.
    'expo-notifications',
    [
      'expo-splash-screen',
      {
        // Mismo fondo que el tema claro, para que no se vea un salto al arrancar.
        backgroundColor: '#F0EEE9',
        dark: { backgroundColor: '#171715' },
        resizeMode: 'contain',
      },
    ],
  ],

  experiments: { typedRoutes: true },

  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    // Lo crea `eas init`. Va por entorno y no escrito aquí porque identifica la
    // cuenta de Expo del propietario, no el código. Sin él no hay token de push.
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
};

export default config;
