export const TERMINAL_RUN_OUTCOMES = [
  'finish',
  'blocked_on_user',
  'failed',
  'cancelled',
] as const;

export const NON_TERMINAL_RUN_OUTCOMES = [
  'progress',
  'continue',
] as const;

export const RUN_OUTCOMES = [
  ...NON_TERMINAL_RUN_OUTCOMES,
  ...TERMINAL_RUN_OUTCOMES,
] as const;

export type TerminalRunOutcome = (typeof TERMINAL_RUN_OUTCOMES)[number];
export type NonTerminalRunOutcome = (typeof NON_TERMINAL_RUN_OUTCOMES)[number];
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

const TERMINAL_RUN_OUTCOME_SET = new Set<string>(TERMINAL_RUN_OUTCOMES);
const NON_TERMINAL_RUN_OUTCOME_SET = new Set<string>(NON_TERMINAL_RUN_OUTCOMES);
const RUN_OUTCOME_SET = new Set<string>(RUN_OUTCOMES);

const RUN_OUTCOME_ALIASES: Readonly<Record<string, RunOutcome>> = {
  finish: 'finish',
  finished: 'finish',
  complete: 'finish',
  completed: 'finish',
  done: 'finish',
  blocked: 'blocked_on_user',
  'blocked-on-user': 'blocked_on_user',
  blocked_on_user: 'blocked_on_user',
  failed: 'failed',
  fail: 'failed',
  error: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  cancel: 'cancelled',
  aborted: 'cancelled',
  abort: 'cancelled',
  progress: 'progress',
  continue: 'continue',
  continued: 'continue',
} as const;

const TERMINAL_PHASE_TO_RUN_OUTCOME: Readonly<Record<string, TerminalRunOutcome>> = {
  complete: 'finish',
  completed: 'finish',
  blocked: 'blocked_on_user',
  blocked_on_user: 'blocked_on_user',
  'blocked-on-user': 'blocked_on_user',
  failed: 'failed',
  cancelled: 'cancelled',
  cancel: 'cancelled',
};

export interface RunOutcomeNormalizationResult {
  outcome?: RunOutcome;
  warning?: string;
  error?: string;
}

export interface RunOutcomeValidationResult {
  ok: boolean;
  state?: Record<string, unknown>;
  warning?: string;
  error?: string;
}

function normalizeRunOutcomeValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRunOutcome(value: unknown): RunOutcomeNormalizationResult {
  const normalized = normalizeRunOutcomeValue(value);
  if (!normalized) return {};
  if (RUN_OUTCOME_SET.has(normalized)) {
    return { outcome: normalized as RunOutcome };
  }
  const alias = RUN_OUTCOME_ALIASES[normalized];
  if (alias) {
    return {
      outcome: alias,
      warning: `normalized legacy run outcome "${value}" -> "${alias}"`,
    };
  }
  return { error: `run_outcome must be one of: ${RUN_OUTCOMES.join(', ')}` };
}

export function classifyRunOutcome(value: unknown): RunOutcome {
  return normalizeRunOutcome(value).outcome ?? 'progress';
}

export function isTerminalRunOutcome(value: unknown): value is TerminalRunOutcome {
  const normalized = normalizeRunOutcome(value).outcome;
  return normalized !== undefined && TERMINAL_RUN_OUTCOME_SET.has(normalized);
}

export function isNonTerminalRunOutcome(value: unknown): value is NonTerminalRunOutcome {
  const normalized = normalizeRunOutcome(value).outcome;
  return normalized !== undefined && NON_TERMINAL_RUN_OUTCOME_SET.has(normalized);
}

export function isNonTerminalRunState(value: unknown): boolean {
  return isNonTerminalRunOutcome(classifyRunOutcome(value));
}

export function isTerminalRunState(value: unknown): boolean {
  return isTerminalRunOutcome(classifyRunOutcome(value));
}

export function inferRunOutcome(candidate: Record<string, unknown>): RunOutcome {
  const explicit = normalizeRunOutcome(candidate.run_outcome);
  if (explicit.outcome) return explicit.outcome;

  const phase = safeString(candidate.current_phase).toLowerCase();
  if (phase && TERMINAL_PHASE_TO_RUN_OUTCOME[phase]) {
    return TERMINAL_PHASE_TO_RUN_OUTCOME[phase];
  }

  if (candidate.active === true) return 'continue';
  if (safeString(candidate.completed_at)) return 'finish';
  if (candidate.active === false) return 'finish';
  return 'continue';
}

export function applyRunOutcomeContract(
  candidate: Record<string, unknown>,
  options?: { nowIso?: string },
): RunOutcomeValidationResult {
  const nowIso = options?.nowIso ?? new Date().toISOString();
  const next: Record<string, unknown> = { ...candidate };
  const normalized = normalizeRunOutcome(next.run_outcome);
  if (normalized.error) return { ok: false, error: normalized.error };

  const outcome = normalized.outcome ?? inferRunOutcome(next);
  next.run_outcome = outcome;

  if (isTerminalRunOutcome(outcome)) {
    if (next.active === true) {
      return { ok: false, error: `terminal run outcome "${outcome}" requires active=false` };
    }
    next.active = false;
    if (!safeString(next.completed_at)) {
      next.completed_at = nowIso;
    }
  } else {
    if (next.active === false) {
      return { ok: false, error: `non-terminal run outcome "${outcome}" requires active=true` };
    }
    next.active = true;
    if (safeString(next.completed_at)) {
      delete next.completed_at;
    }
  }

  return {
    ok: true,
    state: next,
    warning: normalized.warning,
  };
}
