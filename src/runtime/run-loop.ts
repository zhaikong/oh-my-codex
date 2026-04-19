import {
  classifyRunOutcome,
  inferRunOutcome,
  isTerminalRunOutcome,
  type RunOutcome,
  type TerminalRunOutcome,
} from './run-outcome.js';

export interface RunLoopIteration<TState> {
  outcome: unknown;
  state: TState;
}

export interface NormalizedRunLoopIteration<TState> {
  iteration: number;
  outcome: RunOutcome;
  terminal: boolean;
  state: TState;
}

export interface RunLoopTerminalResult<TState> {
  iteration: number;
  outcome: TerminalRunOutcome;
  state: TState;
  history: RunOutcome[];
}

export interface RunUntilTerminalOptions<TState> {
  maxIterations?: number;
  onIteration?: (result: NormalizedRunLoopIteration<TState>) => Promise<void> | void;
}

export interface RunContinuationStateLike {
  current_phase?: unknown;
  run_outcome?: unknown;
  active?: unknown;
  completed_at?: unknown;
  [key: string]: unknown;
}

export interface RunContinuationSnapshot {
  outcome: RunOutcome;
  terminal: boolean;
  phase: string;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function runUntilTerminal<TState>(
  step: (iteration: number) => Promise<RunLoopIteration<TState>>,
  options: RunUntilTerminalOptions<TState> = {},
): Promise<RunLoopTerminalResult<TState>> {
  const history: RunOutcome[] = [];
  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const raw = await step(iteration);
    const outcome = classifyRunOutcome(raw.outcome);
    const terminal = isTerminalRunOutcome(outcome);
    history.push(outcome);

    const normalized: NormalizedRunLoopIteration<TState> = {
      iteration,
      outcome,
      terminal,
      state: raw.state,
    };

    await options.onIteration?.(normalized);

    if (terminal) {
      return {
        iteration,
        outcome,
        state: raw.state,
        history,
      };
    }
  }

  throw new Error(`run loop exceeded maxIterations=${maxIterations} without reaching a terminal outcome`);
}

export function getRunContinuationSnapshot(
  candidate: RunContinuationStateLike | null | undefined,
  options: { phaseFallback?: string } = {},
): RunContinuationSnapshot | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const outcome = inferRunOutcome(candidate as Record<string, unknown>);
  const phase = safeString(candidate.current_phase) || options.phaseFallback || 'active';
  return {
    outcome,
    terminal: isTerminalRunOutcome(outcome),
    phase,
  };
}

export function shouldContinueRun(
  candidate: RunContinuationStateLike | null | undefined,
  options: { phaseFallback?: string } = {},
): boolean {
  const snapshot = getRunContinuationSnapshot(candidate, options);
  return snapshot !== null && !snapshot.terminal;
}
