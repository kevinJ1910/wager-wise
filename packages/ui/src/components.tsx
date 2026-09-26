/**
 * Componentes reutilizables, transcritos del diseño.
 *
 * Todos los tocables respetan los 44px mínimos que el diseño ya usa.
 */

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { GlassCard } from './GlassCard.js';
import { useTheme } from './ThemeProvider.js';
import { MIN_TOUCH_TARGET, RISE_DURATION } from './tokens.js';

// ── Texto ────────────────────────────────────────────────────

type TypeVariant = keyof ReturnType<typeof useTheme>['theme']['type'];
type InkTone = 'ink' | 'ink2' | 'ink3' | 'accent' | 'good' | 'bad' | 'warn';

export interface TxtProps {
  children: React.ReactNode;
  variant?: TypeVariant;
  tone?: InkTone;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** Aplica mayúsculas, como las etiquetas overline del diseño. */
  uppercase?: boolean;
}

export function Txt({
  children,
  variant = 'body',
  tone = 'ink',
  style,
  numberOfLines,
  uppercase,
}: TxtProps): React.ReactElement {
  const { theme } = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        theme.type[variant],
        { color: theme.colors[tone] },
        uppercase && styles.uppercase,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

// ── Botones ──────────────────────────────────────────────────

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'glass' | 'ink';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  /** Icono opcional a la izquierda de la etiqueta (la marca de Google, p. ej.). */
  icon?: React.ReactNode;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
  accessibilityHint,
  icon,
}: ButtonProps): React.ReactElement {
  const { theme } = useTheme();
  const { colors, radius } = theme;

  const palette = {
    primary: { bg: colors.accent, fg: '#FFFFFF' },
    ink: { bg: colors.ink, fg: colors.bg },
    glass: { bg: 'transparent', fg: colors.ink },
  }[variant];

  const content = (
    <>
      {icon}
      <Text style={[theme.type.button, { color: disabled ? colors.ink3 : palette.fg }]}>
        {label}
      </Text>
    </>
  );

  if (variant === 'glass' && !disabled) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }, style]}
      >
        <GlassCard variant="card" radius={radius.button} style={styles.buttonInner}>
          {content}
        </GlassCard>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.buttonInner,
        {
          backgroundColor: disabled ? colors.hair : palette.bg,
          borderRadius: radius.button,
          opacity: pressed && !disabled ? 0.86 : 1,
        },
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

// ── Chips y píldoras ─────────────────────────────────────────

export interface ChipProps {
  label: string;
  active?: boolean;
  onPress?: () => void;
}

export function Chip({ label, active = false, onPress }: ChipProps): React.ReactElement {
  const { theme } = useTheme();
  const { colors, radius } = theme;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: radius.chip,
          backgroundColor: active ? colors.ink : colors.glass,
          borderColor: active ? colors.ink : colors.stroke,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={[theme.type.bodySmall, { color: active ? colors.bg : colors.ink2 }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export type PillTone = 'good' | 'bad' | 'warn' | 'accent';

export function Pill({ label, tone }: { label: string; tone: PillTone }): React.ReactElement {
  const { theme } = useTheme();
  const soft = {
    good: theme.colors.goodSoft,
    bad: theme.colors.badSoft,
    warn: theme.colors.warnSoft,
    accent: theme.colors.accentSoft,
  }[tone];

  return (
    <View style={[styles.pill, { backgroundColor: soft, borderRadius: theme.radius.pill }]}>
      <Text style={[theme.type.pill, { color: theme.colors[tone] }]}>{label}</Text>
    </View>
  );
}

/** Elige el tono de una píldora de EV según su magnitud, como el diseño. */
export function evTone(evPercent: number): PillTone {
  if (evPercent >= 4) return 'good';
  if (evPercent > 0) return 'accent';
  return 'bad';
}

// ── Entradas ─────────────────────────────────────────────────

export interface FieldProps {
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoComplete?: 'email' | 'password' | 'name' | 'off';
  /** Mensaje de error; pinta el borde y se anuncia a lectores de pantalla. */
  error?: string | null;
  textContentType?: 'emailAddress' | 'password' | 'newPassword' | 'name';
}

export function Field({
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType = 'default',
  autoComplete = 'off',
  error,
  textContentType,
}: FieldProps): React.ReactElement {
  const { theme } = useTheme();
  const { colors, radius } = theme;

  return (
    <View>
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={colors.ink3}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoComplete={autoComplete}
        textContentType={textContentType}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
        autoCorrect={false}
        accessibilityLabel={placeholder}
        aria-invalid={Boolean(error)}
        style={[
          theme.type.body,
          styles.field,
          {
            borderRadius: radius.input,
            backgroundColor: colors.glass2,
            borderColor: error ? colors.bad : colors.stroke,
            color: colors.ink,
          },
        ]}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[theme.type.caption, styles.fieldError, { color: colors.bad }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Checkbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}): React.ReactElement {
  const { theme } = useTheme();
  const { colors } = theme;

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={styles.checkboxRow}
    >
      <View
        style={[
          styles.checkbox,
          {
            backgroundColor: checked ? colors.accent : 'transparent',
            borderColor: checked ? colors.accent : colors.stroke,
          },
        ]}
      >
        {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
      </View>
      <Text style={[theme.type.caption, styles.checkboxLabel, { color: colors.ink2 }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Toggle({
  value,
  onToggle,
  label,
}: {
  value: boolean;
  onToggle: () => void;
  label: string;
}): React.ReactElement {
  const { theme } = useTheme();
  const { colors } = theme;

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={[styles.toggleTrack, { backgroundColor: value ? colors.accent : colors.hair }]}
    >
      <View style={[styles.toggleKnob, { transform: [{ translateX: value ? 20 : 0 }] }]} />
    </Pressable>
  );
}

// ── Layout ───────────────────────────────────────────────────

/** Separador de 1px, el `hair` del diseño. */
export function Divider(): React.ReactElement {
  const { theme } = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.colors.hair }]} />;
}

/** Etiqueta de sección en mayúsculas con tracking amplio. */
export function Overline({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Txt variant="overline" tone="ink3" uppercase>
      {children}
    </Txt>
  );
}

/** Entrada escalonada de tarjetas: el keyframe `rise` del diseño. */
export function Rise({
  children,
  index = 0,
}: {
  children: React.ReactNode;
  index?: number;
}): React.ReactElement {
  const { reduceMotion } = useTheme();

  if (reduceMotion) return <>{children}</>;

  return (
    <Animated.View entering={FadeInDown.duration(RISE_DURATION).delay(index * 45)}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  uppercase: { textTransform: 'uppercase' },
  buttonInner: {
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 11,
  },
  chip: {
    minHeight: 38,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  pill: { paddingHorizontal: 11, paddingVertical: 6 },
  field: {
    height: 52,
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  fieldError: { paddingLeft: 6, marginTop: 5 },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMark: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', lineHeight: 14 },
  checkboxLabel: { flex: 1 },
  toggleTrack: {
    width: 50,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: 'center',
  },
  toggleKnob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  divider: { height: StyleSheet.hairlineWidth },
});
