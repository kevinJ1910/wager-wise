/**
 * Contexto de tema.
 *
 * Tres estados, como pide el diseño: claro, oscuro y seguir al sistema. La
 * preferencia se persiste fuera de este componente (el que lo monta decide
 * dónde), para que el paquete de UI no dependa de ningún almacenamiento.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import { buildTheme, type Theme, type ThemeName } from './tokens.js';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** True si el usuario pidió reducir transparencias: el cristal se vuelve sólido. */
  reduceTransparency: boolean;
  /** True si pidió reducir movimiento: las burbujas se congelan. */
  reduceMotion: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: React.ReactNode;
  preference: ThemePreference;
  onPreferenceChange: (preference: ThemePreference) => void;
}

export function ThemeProvider({
  children,
  preference,
  onPreferenceChange,
}: ThemeProviderProps): React.ReactElement {
  const systemScheme = useColorScheme();
  const [reduceTransparency, setReduceTransparency] = React.useState(false);
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    // Ambas preferencias pueden cambiar mientras la app está abierta, así que
    // además de leerlas al montar nos suscribimos a los cambios.
    void AccessibilityInfo.isReduceTransparencyEnabled?.().then((value) => {
      if (active) setReduceTransparency(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduceMotion(value);
    });

    const transparencySub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );
    const motionSub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => {
      active = false;
      transparencySub?.remove();
      motionSub?.remove();
    };
  }, []);

  const resolved: ThemeName =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: buildTheme(resolved),
      preference,
      setPreference: onPreferenceChange,
      reduceTransparency,
      reduceMotion,
    }),
    [resolved, preference, onPreferenceChange, reduceTransparency, reduceMotion],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme debe usarse dentro de <ThemeProvider>.');
  }
  return context;
}

/** Atajo para el caso común de sólo necesitar los tokens. */
export function useColors(): Theme['colors'] {
  return useTheme().theme.colors;
}
