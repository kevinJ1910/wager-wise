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
  owner: 'kevnjordn',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'wagerwise',
  userInterfaceStyle: 'automatic',
  // Iconos generados a partir de Logo.tsx: mismo degradado, brillos y W.
  icon: './assets/images/icon.png',

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
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#C15F3C',
    },
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
        // Sin imagen, Android no compila: el tema nativo referencia
        // splashscreen_logo y el plugin sólo lo genera si se le da una.
        image: './assets/images/splash-icon.png',
        imageWidth: 112,
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
    // Proyecto de EAS (lo creó `eas init`). No es secreto: sólo identifica el
    // proyecto en expo.dev, y sin él no hay builds ni token de push.
    eas: { projectId: '67fc6279-a5ff-4d0a-8f15-cbafab1c5b9f' },
  },
};

export default config;
