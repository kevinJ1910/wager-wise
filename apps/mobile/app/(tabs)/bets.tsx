import React from 'react';
import { ComingSoon } from '@/components/ComingSoon';

export default function BetsRoute(): React.ReactElement {
  return (
    <ComingSoon
      overline="Historial · últimos 30 días"
      title="Mis apuestas"
      phase="Fase 3"
      description="El seguimiento de apuestas se apoya en resultados liquidados, que llegan con la ingesta de partidos terminados."
      bullets={[
        'Profit/loss con la evolución del bankroll',
        'Acierto, ROI y CLV frente a la línea de cierre',
        'Historial de parlays ganados, perdidos y abiertos',
      ]}
    />
  );
}
