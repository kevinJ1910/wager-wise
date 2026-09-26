/**
 * Logotipo: cuadrado redondeado con degradado coral, dos brillos difusos y la
 * W en Newsreader. El diseño lo especifica a 112 / 76 / 52 / 38 / 34 px.
 */

import { BRAND_GRADIENT, fonts } from '@wagerwise/ui';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function Logo({ size = 112 }: { size?: number }): React.ReactElement {
  // Las proporciones del diseño, escaladas desde la versión de 112px.
  const scale = size / 112;
  const radius = 30 * scale;

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: radius,
          shadowRadius: 44 * scale,
          shadowOffset: { width: 0, height: 20 * scale },
        },
      ]}
    >
      <LinearGradient
        colors={[...BRAND_GRADIENT]}
        locations={[0, 0.56, 1]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Brillos difusos de las esquinas, como los `filter: blur()` del diseño. */}
      <View
        style={[
          styles.glow,
          {
            width: 78 * scale,
            height: 78 * scale,
            borderRadius: 39 * scale,
            top: -18 * scale,
            left: -14 * scale,
            opacity: 0.34,
          },
        ]}
      />
      <View
        style={[
          styles.glow,
          {
            width: 86 * scale,
            height: 86 * scale,
            borderRadius: 43 * scale,
            bottom: -26 * scale,
            right: -18 * scale,
            opacity: 0.2,
          },
        ]}
      />

      <View style={styles.center}>
        <Text style={[styles.letter, { fontSize: 58 * scale, lineHeight: 62 * scale }]}>W</Text>
      </View>

      {size >= 52 ? (
        <View
          style={[
            styles.dot,
            {
              width: 14 * scale,
              height: 14 * scale,
              borderRadius: 7 * scale,
              bottom: 18 * scale,
              right: 18 * scale,
              borderWidth: 5 * scale,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    shadowColor: '#C15F3C',
    shadowOpacity: 0.45,
    elevation: 10,
  },
  glow: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
  },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  letter: {
    fontFamily: fonts.serifMedium,
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  dot: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderColor: 'rgba(255,255,255,0.22)',
  },
});
