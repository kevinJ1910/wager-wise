/**
 * Aviso de datos de muestra.
 *
 * Mientras no haya claves de API configuradas, la app calcula con partidos de
 * ejemplo. La matemática es real, los partidos no — y eso tiene que estar dicho
 * en pantalla, no sólo en el README. Un análisis de apuestas que parece real sin
 * serlo es peor que no tener pantalla.
 */

import { GlassCard, Txt } from '@wagerwise/ui';
import React from 'react';
import { StyleSheet } from 'react-native';
import { isBackendConfigured } from '@/lib/supabase';

export function SampleDataBanner(): React.ReactElement | null {
  // En cuanto el backend esté conectado y sirviendo datos, este aviso
  // desaparece solo.
  if (isBackendConfigured) return null;

  return (
    <GlassCard variant="card" style={styles.banner}>
      <Txt variant="caption" tone="warn">
        Datos de muestra
      </Txt>
      <Txt variant="caption" tone="ink2">
        Los cálculos son reales, pero los partidos y las cuotas son de ejemplo. Configura las
        claves de API para ver los partidos de hoy.
      </Txt>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  banner: { padding: 14, gap: 4 },
});
