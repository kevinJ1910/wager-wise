/**
 * Superficie de cristal.
 *
 * Base: `expo-blur`, estable en iOS y Android desde Expo SDK 55 (usa la API
 * RenderNode en Android). Deliberadamente NO se apoya en `expo-glass-effect`:
 * está limitado a iOS 26 y tuvo una regresión en SDK 55, así que sirve como
 * mejora progresiva, no como cimiento.
 *
 * Si el usuario activó "reducir transparencia", se sustituye por una superficie
 * sólida equivalente. El desenfoque es decorativo; la legibilidad no.
 */

import { BlurView } from 'expo-blur';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from './ThemeProvider.js';
import type { ThemeName } from './tokens.js';

export type GlassVariant = 'card' | 'hero' | 'inner' | 'tabBar';

export interface GlassCardProps {
  children?: React.ReactNode;
  variant?: GlassVariant;
  style?: StyleProp<ViewStyle>;
  /** Sobrescribe el radio del variant. */
  radius?: number;
  /** Resalta el borde en acento, para el estado seleccionado. */
  selected?: boolean;
  /** Tinte de fondo, por ejemplo el del auditor según severidad. */
  tint?: string;
}

export function GlassCard({
  children,
  variant = 'card',
  style,
  radius,
  selected = false,
  tint,
}: GlassCardProps): React.ReactElement {
  const { theme, reduceTransparency } = useTheme();
  const { colors } = theme;

  const config = {
    card: { blur: theme.blur.card, radius: theme.radius.card, shadow: theme.shadows.card, surface: colors.glass },
    hero: { blur: theme.blur.hero, radius: theme.radius.cardLarge, shadow: theme.shadows.hero, surface: colors.glass },
    inner: { blur: theme.blur.subtle, radius: theme.radius.inner, shadow: undefined, surface: colors.glass2 },
    tabBar: { blur: theme.blur.tabBar, radius: theme.radius.tabBar, shadow: theme.shadows.hero, surface: colors.glass },
  }[variant];

  const borderRadius = radius ?? config.radius;

  const frame: ViewStyle = {
    borderRadius,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: selected ? colors.accent : colors.stroke,
    overflow: 'hidden',
    ...(config.shadow ? { ...config.shadow, shadowColor: colors.shadow } : {}),
  };

  // Sin transparencia el desenfoque no aporta nada y sí cuesta: una vista
  // plana con el color compuesto es mejor en accesibilidad y en rendimiento.
  if (reduceTransparency) {
    return (
      <View style={[frame, { backgroundColor: solidSurface(theme.name, variant) }, style]}>
        {tint ? <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} /> : null}
        {children}
      </View>
    );
  }

  return (
    <View style={[frame, style]}>
      <BlurView
        intensity={config.blur}
        tint={theme.scheme === 'dark' ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      {/* El BlurView solo desenfoca lo de detrás; la capa de color es la que da
          el tono lechoso del cristal del diseño. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint ?? config.surface }]} />
      {children}
    </View>
  );
}

/**
 * Equivalente opaco del cristal, para el modo sin transparencias.
 *
 * Son los colores que resultan de componer `glass`/`glass2` sobre `bg`, de modo
 * que la jerarquía visual se mantiene aunque no haya desenfoque. Deben ser
 * totalmente opacos: cualquier alfa aquí deja la tarjeta invisible.
 */
function solidSurface(themeName: ThemeName, variant: GlassVariant): string {
  if (themeName === 'dark') {
    return variant === 'inner' ? '#1F1F1D' : '#262624';
  }
  return variant === 'inner' ? '#F7F5F1' : '#FBFAF7';
}
