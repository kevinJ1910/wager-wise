/**
 * Estado del constructor de parlays.
 *
 * Vive en memoria y se persiste en AsyncStorage: el usuario puede cerrar la app
 * a media construcción y volver sin perder las legs.
 *
 * Este store guarda *sólo* las selecciones. Todo el cálculo (cuota combinada,
 * probabilidad conjunta, EV, auditoría) lo hace `@wagerwise/engine` a partir de
 * aquí, en un selector derivado. Nunca se guarda un número calculado: sería
 * otra fuente de verdad que podría quedar desincronizada.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ParlayLeg } from '@wagerwise/engine';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface BuilderState {
  legs: ParlayLeg[];
  /** Porcentaje del bankroll, 1-12, como el slider del diseño. */
  stakePct: number;
  /** True cuando el usuario ya registró la apuesta. */
  placed: boolean;

  addLeg: (leg: ParlayLeg) => void;
  removeLeg: (legId: string) => void;
  removeLegs: (legIds: string[]) => void;
  toggleLeg: (leg: ParlayLeg) => void;
  hasLeg: (legId: string) => boolean;
  setStakePct: (pct: number) => void;
  loadParlay: (legs: ParlayLeg[]) => void;
  clear: () => void;
}

export const useBuilder = create<BuilderState>()(
  persist(
    (set, get) => ({
      legs: [],
      stakePct: 4,
      placed: false,

      addLeg: (leg) =>
        set((state) => {
          if (state.legs.some((l) => l.id === leg.id)) return state;
          return { legs: [...state.legs, leg], placed: false };
        }),

      removeLeg: (legId) =>
        set((state) => ({ legs: state.legs.filter((l) => l.id !== legId), placed: false })),

      removeLegs: (legIds) =>
        set((state) => ({
          legs: state.legs.filter((l) => !legIds.includes(l.id)),
          placed: false,
        })),

      toggleLeg: (leg) =>
        set((state) => {
          const exists = state.legs.some((l) => l.id === leg.id);
          return {
            legs: exists ? state.legs.filter((l) => l.id !== leg.id) : [...state.legs, leg],
            placed: false,
          };
        }),

      hasLeg: (legId) => get().legs.some((l) => l.id === legId),

      // El diseño acota el slider a 1-12%; el auditor avisa por encima del tope
      // del perfil, pero no impide moverlo.
      setStakePct: (pct) => set({ stakePct: Math.min(12, Math.max(1, Math.round(pct))), placed: false }),

      loadParlay: (legs) => set({ legs, placed: false }),

      clear: () => set({ legs: [], placed: false }),
    }),
    {
      name: 'wagerwise:builder',
      storage: createJSONStorage(() => AsyncStorage),
      // `placed` es efímero: al reabrir la app el parlay vuelve a estar editable.
      partialize: (state) => ({ legs: state.legs, stakePct: state.stakePct }),
    },
  ),
);

/** Marca el parlay como registrado. Fuera del store para poder testearlo aparte. */
export function markPlaced(): void {
  useBuilder.setState({ placed: true });
}
