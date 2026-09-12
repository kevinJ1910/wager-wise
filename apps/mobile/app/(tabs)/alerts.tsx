import React from 'react';
import { ComingSoon } from '@/components/ComingSoon';

export default function AlertsRoute(): React.ReactElement {
  return (
    <ComingSoon
      overline="Value bets · en vivo"
      title="Alertas de valor"
      phase="Fase 2"
      description="Las alertas necesitan snapshots de cuotas reales para detectar cuándo una línea se mueve y abre valor. Llegan con la ingesta conectada."
      bullets={[
        'Filtros por EV y por confianza, como en el diseño',
        'Notificación push cuando aparece EV superior al 5%',
        'Un toque para añadir la selección al builder',
      ]}
    />
  );
}
