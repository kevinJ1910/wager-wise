export {
  decimalToImplied,
  impliedToDecimal,
  overround,
  bookmakerMargin,
  removeVigMultiplicative,
  removeVigShin,
} from './odds.js';

export {
  consensusProbabilities,
  type BookQuote,
  type ConsensusResult,
  type ConsensusOptions,
  type DevigMethod,
} from './consensus.js';

export {
  fitDixonColes,
  scoreMatrix,
  scoreMatrixFromRates,
  expectedGoals,
  tau,
  type DixonColesModel,
  type HistoricalMatch,
  type TeamRating,
  type FitOptions,
} from './dixon-coles.js';

export {
  resolveSelection,
  selectionProbabilities,
  selectionProbability,
  jointProbability,
  selectionCorrelation,
  matchResultProbabilities,
  describeSelection,
  type Selection,
  type SelectionOutcome,
  type SelectionProbabilities,
} from './markets.js';

export {
  blendProbabilities,
  edge,
  expectedValue,
  kellyFraction,
  recommendStake,
  RISK_PROFILES,
  type RiskProfile,
  type RiskProfileId,
  type StakeRecommendation,
} from './value.js';

export {
  closingLineValue,
  parlayClv,
  parlayPayout,
  parlayStatus,
  settleLeg,
  summarizeBets,
  type BetStats,
  type BetStatus,
  type SettledLeg,
  type TrackedBet,
} from './tracking.js';

export {
  evaluateParlay,
  auditParlay,
  type ParlayLeg,
  type ParlayEvaluation,
  type ScoreMatrixByFixture,
  type CorrelatedGroup,
  type AuditCheck,
  type AuditInput,
  type AuditResult,
  type CheckSeverity,
} from './parlay.js';
