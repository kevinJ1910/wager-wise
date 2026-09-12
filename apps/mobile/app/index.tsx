/**
 * Splash: entrada a la autenticación.
 */

import { Button, Txt, useTheme } from '@wagerwise/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logo } from '@/components/Logo';

export default function SplashRoute(): React.ReactElement {
  const router = useRouter();
  const { theme } = useTheme();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.hero}>
          <Logo size={112} />

          <View style={styles.titleBlock}>
            <Txt variant="displayLarge">WagerWise</Txt>
            <Txt variant="body" tone="ink2" style={styles.tagline}>
              Análisis de apuestas y parlays auditados. Sin errores de correlación, sin EV negativo.
            </Txt>
          </View>
        </View>

        <View style={styles.actions}>
          <Button label="Crear cuenta" onPress={() => router.push('/auth?mode=register')} />
          <Button
            label="Ya tengo cuenta"
            variant="glass"
            onPress={() => router.push('/auth?mode=login')}
          />
          <Txt variant="caption" tone="ink3" style={styles.legal}>
            Solo para mayores de 18 años. Juega con responsabilidad.
          </Txt>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 30 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 26 },
  titleBlock: { alignItems: 'center', gap: 10 },
  tagline: { textAlign: 'center', maxWidth: 270 },
  actions: { gap: 11 },
  legal: { textAlign: 'center', marginTop: 6 },
});
