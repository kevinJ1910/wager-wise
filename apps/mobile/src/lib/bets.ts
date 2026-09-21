/**
 * Apuestas del usuario: registrarlas y leer el historial.
 *
 * El estado de una apuesta —ganada, perdida, anulada— nunca se decide aquí. Lo
 * escribe la Edge Function `settle-bets` con service role, contra el marcador
 * real. Esta capa sólo lee lo que ya está decidido: si el cliente pudiera
 * marcar una apuesta como ganada, el historial dejaría de ser un registro para
 * ser una opinión.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { selectionSchema } from '@wagerwise/core';
import {
  describeSelection,
  summarizeBets,
  type BetStats,
  type BetStatus,
  type ParlayLeg,
  type Selection,
} from '@wagerwise/engine';
import { isBackendConfigured, supabase } from './supabase.js';

export interface BetLegView {
  id: string;
  fixtureId: string;
  label: string;
  matchLabel: string;
  odds: number;
  closingOdds: number | null;
  status: BetStatus;
  kickoffAt: Date | null;
}

export interface BetView {
  id: string;
  title: string | null;
  stake: number;
  currency: string;
  combinedOdds: number;
  trueProbability: number | null;
  expectedValue: number | null;
  status: BetStatus;
  payout: number | null;
  clv: number | null;
  placedAt: Date;
  settledAt: Date | null;
  legs: BetLegView[];
  /** Resultado neto. Null mientras siga abierta: todavía no ha pasado nada. */
  profit: number | null;
}

export interface BetsData {
  bets: BetView[];
  stats: BetStats;
  isLoading: boolean;
  error: Error | null;
}

export function useBets(): BetsData {
  const query = useQuery({
    queryKey: ['bets'],
    enabled: isBackendConfigured,
    queryFn: fetchBets,
  });

  const bets = query.data ?? [];

  return {
    bets,
    stats: summarizeBets(
      bets.map((bet) => ({
        stake: bet.stake,
        status: bet.status,
        payout: bet.payout,
        clv: bet.clv,
        settledAt: bet.settledAt?.toISOString() ?? null,
      })),
    ),
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

async function fetchBets(): Promise<BetView[]> {
  const { data, error } = await supabase
    .from('user_parlays')
    .select(
      `id, title, stake, currency, combined_odds, true_probability, expected_value,
       status, payout, clv, placed_at, settled_at,
       legs:user_parlay_legs(
         id, fixture_id, selection, odds, closing_odds, status, position,
         fixture:fixtures(
           kickoff_at,
           home:teams!fixtures_home_team_id_fkey(name),
           away:teams!fixtures_away_team_id_fkey(name)
         )
       )`,
    )
    .order('placed_at', { ascending: false })
    .limit(200);

  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`);

  return ((data ?? []) as unknown as ParlayRow[]).map(toBetView);
}

function toBetView(row: ParlayRow): BetView {
  const stake = Number(row.stake);
  const payout = row.payout === null ? null : Number(row.payout);

  const legs = (row.legs ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(toLegView);

  return {
    id: row.id,
    title: row.title,
    stake,
    currency: row.currency,
    combinedOdds: row.combined_odds,
    trueProbability: row.true_probability,
    expectedValue: row.expected_value,
    status: row.status,
    payout,
    clv: row.clv,
    placedAt: new Date(row.placed_at),
    settledAt: row.settled_at ? new Date(row.settled_at) : null,
    legs,
    profit: payout === null ? null : payout - stake,
  };
}

function toLegView(row: LegRow): BetLegView {
  const parsed = selectionSchema.safeParse(row.selection);
  const home = row.fixture?.home?.name;
  const away = row.fixture?.away?.name;

  return {
    id: row.id,
    fixtureId: row.fixture_id,
    // Una selección ilegible no debe tumbar el historial entero: se muestra el
    // hueco y el resto de la apuesta sigue siendo legible.
    label: parsed.success ? describeSelection(parsed.data as Selection) : 'Selección desconocida',
    matchLabel: home && away ? `${home} vs ${away}` : row.fixture_id,
    odds: row.odds,
    closingOdds: row.closing_odds,
    status: row.status,
    kickoffAt: row.fixture?.kickoff_at ? new Date(row.fixture.kickoff_at) : null,
  };
}

// ─────────────────────────────────────────────────────────────
// Registrar
// ─────────────────────────────────────────────────────────────

export interface PlaceParlayInput {
  legs: readonly ParlayLeg[];
  stake: number;
  currency: string;
  combinedOdds: number;
  trueProbability: number;
  expectedValue: number;
}

/**
 * Registra el parlay a través de `place_parlay`.
 *
 * Un RPC y no tres inserts: parlay, legs y apunte de bankroll entran en la
 * misma transacción, así que no puede quedar una apuesta con stake y sin
 * selecciones si se corta la conexión a mitad.
 */
export function usePlaceParlay() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: PlaceParlayInput): Promise<string> => {
      if (!isBackendConfigured) {
        throw new Error('Conecta el backend para registrar apuestas.');
      }
      if (input.legs.length < 2) {
        throw new Error('Un parlay necesita al menos dos selecciones.');
      }

      const { data, error } = await supabase.rpc('place_parlay', {
        p_stake: input.stake,
        p_currency: input.currency,
        p_combined_odds: input.combinedOdds,
        p_true_probability: input.trueProbability,
        p_expected_value: input.expectedValue,
        p_legs: input.legs.map((leg) => ({
          fixture_id: leg.fixtureId,
          selection: leg.selection,
          odds: leg.odds,
          probability: leg.probability,
        })),
        p_title: titleOf(input.legs),
      });

      if (error) throw new Error(`No se pudo registrar la apuesta: ${error.message}`);
      return data as string;
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bets'] });
    },
  });
}

/** Título legible: el partido si es uno solo, el número de legs si son varios. */
function titleOf(legs: readonly ParlayLeg[]): string {
  const matches = new Set(legs.map((leg) => leg.fixtureId));
  if (matches.size === 1 && legs[0]?.matchLabel) return legs[0].matchLabel;
  return `Parlay de ${legs.length} legs`;
}

// ─────────────────────────────────────────────────────────────
// Filas de PostgREST
// ─────────────────────────────────────────────────────────────

interface LegRow {
  id: string;
  fixture_id: string;
  selection: unknown;
  odds: number;
  closing_odds: number | null;
  status: BetStatus;
  position: number;
  fixture: {
    kickoff_at: string;
    home: { name: string } | null;
    away: { name: string } | null;
  } | null;
}

interface ParlayRow {
  id: string;
  title: string | null;
  stake: string | number;
  currency: string;
  combined_odds: number;
  true_probability: number | null;
  expected_value: number | null;
  status: BetStatus;
  payout: string | number | null;
  clv: number | null;
  placed_at: string;
  settled_at: string | null;
  legs: LegRow[] | null;
}
