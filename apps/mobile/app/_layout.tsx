import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from '@expo-google-fonts/hanken-grotesk';
import { Newsreader_400Regular, Newsreader_500Medium } from '@expo-google-fonts/newsreader';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Bubbles, ThemeProvider, useTheme } from '@wagerwise/ui';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useProfileSync } from '@/lib/profile';
import { usePreferences } from '@/state/preferences';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Las cuotas se refrescan por cron cada pocas horas; 5 minutos de datos
      // frescos evita refetches innecesarios sin mostrar precios rancios.
      staleTime: 5 * 60 * 1000,
      retry: 2,
    },
  },
});

export default function RootLayout(): React.ReactElement | null {
  const [fontsLoaded, fontError] = useFonts({
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
    Newsreader_400Regular,
    Newsreader_500Medium,
  });

  const themePreference = usePreferences((s) => s.theme);
  const setTheme = usePreferences((s) => s.setTheme);
  const hydrated = usePreferences((s) => s.hydrated);

  const ready = (fontsLoaded || Boolean(fontError)) && hydrated;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider preference={themePreference} onPreferenceChange={setTheme}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AppShell />
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Fondo, burbujas y navegación.
 *
 * Las burbujas se montan aquí y no en cada pantalla: son fondo continuo, y
 * remontarlas en cada navegación reiniciaría la animación de golpe.
 */
function AppShell(): React.ReactElement {
  const { theme } = useTheme();

  useProtectedRoute();
  // El perfil del servidor manda al entrar: bankroll, moneda y ajustes viajan
  // con la cuenta, no con el dispositivo.
  useProfileSync();

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg }]}>
      <Bubbles />
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    </View>
  );
}

/**
 * Redirige según sesión y onboarding.
 *
 * Se ejecuta en un efecto y no durante el render porque expo-router no permite
 * navegar mientras se está montando el árbol.
 */
function useProtectedRoute(): void {
  const { session, initializing } = useAuth();
  const onboarded = usePreferences((s) => s.onboarded);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return;

    const inTabs = segments[0] === '(tabs)';
    const onOnboarding = segments[0] === 'onboarding';

    if (!session) {
      // Sin sesión, cualquier ruta protegida vuelve al splash.
      if (inTabs || onOnboarding) router.replace('/');
      return;
    }

    if (!onboarded && !onOnboarding) {
      router.replace('/onboarding');
      return;
    }

    // Sólo las rutas de entrada —splash, auth, onboarding— llevan a las
    // pestañas. Rebotar cualquier ruta fuera del grupo dejaría inalcanzable el
    // detalle de partido, que vive fuera a propósito para poder abrirse encima
    // de la pestaña que sea.
    // El splash es la raíz, sin segmento; las rutas tipadas no lo modelan como
    // array vacío, así que se lee como cadena suelta.
    const [first] = segments as readonly (string | undefined)[];
    const onEntryRoute = !first || first === 'auth' || onOnboarding;

    if (onboarded && onEntryRoute) {
      router.replace('/(tabs)');
    }
  }, [session, initializing, onboarded, segments, router]);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
