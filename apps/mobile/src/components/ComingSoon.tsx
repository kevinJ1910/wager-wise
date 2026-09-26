/**
 * Marcador de pantalla pendiente.
 *
 * El diseño define cinco pestañas y la barra las muestra todas, así que estas
 * rutas tienen que existir desde la Fase 1. Prefiero decir con claridad qué
 * falta y cuándo llega antes que enseñar una pantalla con datos inventados que
 * parezcan reales.
 */

import { GlassCard, Overline, Txt } from '@wagerwise/ui';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface ComingSoonProps {
  overline: string;
  title: string;
  phase: string;
  description: string;
  bullets: string[];
}

export function ComingSoon({
  overline,
  title,
  phase,
  description,
  bullets,
}: ComingSoonProps): React.ReactElement {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Overline>{overline}</Overline>
          <Txt variant="display" style={styles.title}>
            {title}
          </Txt>
        </View>

        <GlassCard variant="hero" style={styles.card}>
          <Txt variant="caption" tone="accent" uppercase>
            {phase}
          </Txt>
          <Txt variant="body" tone="ink2">
            {description}
          </Txt>

          <View style={styles.bullets}>
            {bullets.map((bullet) => (
              <View key={bullet} style={styles.bulletRow}>
                <Txt variant="bodySmall" tone="ink3">
                  ·
                </Txt>
                <Txt variant="bodySmall" tone="ink2" style={styles.bulletText}>
                  {bullet}
                </Txt>
              </View>
            ))}
          </View>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingBottom: 24, gap: 16 },
  header: { paddingHorizontal: 4, gap: 7 },
  title: {},
  card: { padding: 22, gap: 14 },
  bullets: { gap: 8 },
  bulletRow: { flexDirection: 'row', gap: 8 },
  bulletText: { flex: 1 },
});
