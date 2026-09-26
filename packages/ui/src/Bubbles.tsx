/**
 * Las tres burbujas de fondo.
 *
 * Reproducen las animaciones `fl1`/`fl2`/`fl3` del diseño: derivas lentas de
 * 17, 21 y 25 segundos en bucle, con escalado suave. Corren en el hilo de UI
 * vía Reanimated, así que no compiten con el scroll.
 *
 * Se monta una sola vez a nivel de layout, no por pantalla: son fondo, y
 * remontarlas en cada navegación reiniciaría la animación de golpe.
 */

import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from './ThemeProvider.js';
import { BUBBLE_DURATIONS } from './tokens.js';

interface BubbleSpec {
  color: string;
  size: number;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  /** Desplazamiento en el punto medio de la animación, como en el diseño. */
  shift: { x: number; y: number };
  scale: number;
  duration: number;
}

export function Bubbles(): React.ReactElement {
  const { theme, reduceMotion } = useTheme();
  const { colors } = theme;

  const specs: BubbleSpec[] = [
    {
      color: colors.bubble1,
      size: 300,
      top: 40,
      left: -40,
      shift: { x: 26, y: -34 },
      scale: 1.12,
      duration: BUBBLE_DURATIONS[0],
    },
    {
      color: colors.bubble2,
      size: 290,
      top: 300,
      right: -70,
      shift: { x: -30, y: 28 },
      scale: 1.08,
      duration: BUBBLE_DURATIONS[1],
    },
    {
      color: colors.bubble3,
      size: 260,
      bottom: 20,
      left: 30,
      shift: { x: 18, y: 26 },
      scale: 1.16,
      duration: BUBBLE_DURATIONS[2],
    },
  ];

  return (
    <View style={styles.container} pointerEvents="none">
      {specs.map((spec, index) => (
        <Bubble key={index} spec={spec} frozen={reduceMotion} />
      ))}
    </View>
  );
}

function Bubble({ spec, frozen }: { spec: BubbleSpec; frozen: boolean }): React.ReactElement {
  // Un único valor 0→1 gobierna la deriva y la escala, igual que el keyframe
  // del diseño lleva ambas al 50%.
  const progress = useSharedValue(0);

  useEffect(() => {
    if (frozen) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }

    progress.value = withRepeat(
      withTiming(1, { duration: spec.duration, easing: Easing.inOut(Easing.ease) }),
      -1,
      true, // invierte al llegar, que es el 0% → 50% → 100% del keyframe
    );

    return () => cancelAnimation(progress);
  }, [frozen, spec.duration, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * spec.shift.x },
      { translateY: progress.value * spec.shift.y },
      { scale: 1 + progress.value * (spec.scale - 1) },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.bubble,
        {
          width: spec.size,
          height: spec.size,
          borderRadius: spec.size / 2,
          top: spec.top,
          bottom: spec.bottom,
          left: spec.left,
          right: spec.right,
        },
        animatedStyle,
      ]}
    >
      {/*
        El diseño usa `radial-gradient(circle, color, transparent 70%)`, que
        React Native no tiene. Un degradado lineal dentro de un círculo con
        opacidad decreciente da el mismo efecto difuso a este tamaño y con este
        nivel de desenfoque.
      */}
      <LinearGradient
        colors={[spec.color, 'transparent']}
        start={{ x: 0.35, y: 0.3 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    // El diseño extiende el lienzo 80px por cada lado para que las burbujas
    // puedan salirse del borde sin cortarse.
    margin: -80,
    overflow: 'hidden',
  },
  bubble: {
    position: 'absolute',
    overflow: 'hidden',
    opacity: 0.9,
  },
});
