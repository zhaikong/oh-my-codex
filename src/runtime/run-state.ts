import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';

import { getStateFilePath, resolveStateScope } from '../mcp/state-paths.js';
import {
  classifyRunOutcome,
  isTerminalRunOutcome,
  normalizeRunOutcome,
  type RunOutcome,
} from './run-outcome.js';

const RUN_STATE_FILENAME = 'run-state.json';

export interface RunStateLike {
  active?: unknown;
  mode?: unknown;
  current_phase?: unknown;
  task_description?: unknown;
  started_at?: unknown;
  completed_at?: unknown;
  iteration?: unknown;
  max_iterations?: unknown;
  error?: unknown;
  outcome?: unknown;
  run_outcome?: unknown;
  owner_omx_session_id?: unknown;
  [key: string]: unknown;
}

export interface RunState {
  version: 1;
  mode: string;
  active: boolean;
  outcome: RunOutcome;
  updated_at: string;
  current_phase?: string;
  task_description?: string;
  started_at?: string;
  completed_at?: string;
  iteration?: number;
  max_iterations?: number;
  error?: string;
  owner_omx_session_id?: string;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function terminalOutcomeFromPhase(phase: string | undefined): RunOutcome | null {
  if (!phase) return null;
  const normalizedPhase = normalizeRunOutcome(phase).outcome;
  return normalizedPhase && isTerminalRunOutcome(normalizedPhase) ? normalizedPhase : null;
}

export function deriveRunOutcomeFromModeState(state: RunStateLike): RunOutcome {
  if (state.active === true) return 'continue';

  const explicitOutcome = normalizeRunOutcome(state.outcome ?? state.run_outcome).outcome;
  if (explicitOutcome) return explicitOutcome;

  const phaseOutcome = terminalOutcomeFromPhase(optionalString(state.current_phase));
  if (phaseOutcome) return phaseOutcome;

  if (optionalString(state.error)) return 'failed';
  if (optionalString(state.completed_at)) return 'finish';

  return classifyRunOutcome(state.current_phase);
}

export function buildRunState(
  state: RunStateLike,
  existing?: Partial<RunState> | null,
  nowIso: string = new Date().toISOString(),
): RunState {
  const outcome = deriveRunOutcomeFromModeState(state);
  const active = state.active === true;
  const next: RunState = {
    version: 1,
    mode: optionalString(state.mode) ?? optionalString(existing?.mode) ?? 'unknown',
    active,
    outcome,
    updated_at: nowIso,
  };

  const currentPhase = optionalString(state.current_phase);
  if (currentPhase) next.current_phase = currentPhase;

  const taskDescription = optionalString(state.task_description);
  if (taskDescription) next.task_description = taskDescription;

  const startedAt = optionalString(state.started_at) ?? optionalString(existing?.started_at);
  if (startedAt) next.started_at = startedAt;

  const completedAt = active
    ? undefined
    : optionalString(state.completed_at)
      ?? (isTerminalRunOutcome(outcome) ? optionalString(existing?.completed_at) ?? nowIso : undefined);
  if (completedAt) next.completed_at = completedAt;

  const iteration = optionalFiniteNumber(state.iteration);
  if (iteration !== undefined) next.iteration = iteration;

  const maxIterations = optionalFiniteNumber(state.max_iterations);
  if (maxIterations !== undefined) next.max_iterations = maxIterations;

  const error = optionalString(state.error);
  if (error) next.error = error;

  const ownerSessionId = optionalString(state.owner_omx_session_id);
  if (ownerSessionId) next.owner_omx_session_id = ownerSessionId;

  return next;
}

function getRunStatePath(workingDirectory?: string, sessionId?: string): string {
  return getStateFilePath(RUN_STATE_FILENAME, workingDirectory, sessionId);
}

async function writeAtomicFile(path: string, data: string): Promise<void> {
  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  await writeFile(tmpPath, data, 'utf-8');
  try {
    await rename(tmpPath, path);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

export async function readRunState(
  workingDirectory?: string,
  explicitSessionId?: string,
): Promise<RunState | null> {
  const scope = await resolveStateScope(workingDirectory, explicitSessionId);
  const path = getRunStatePath(workingDirectory, scope.sessionId);
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(await readFile(path, 'utf-8')) as RunState;
  } catch {
    return null;
  }
}

export async function syncRunStateFromModeState(
  state: RunStateLike,
  workingDirectory?: string,
  explicitSessionId?: string,
): Promise<RunState> {
  const scope = await resolveStateScope(workingDirectory, explicitSessionId);
  const path = getRunStatePath(workingDirectory, scope.sessionId);
  await mkdir(scope.stateDir, { recursive: true });

  const existing = await readRunState(workingDirectory, scope.sessionId);
  const next = buildRunState(state, existing);
  await writeAtomicFile(path, JSON.stringify(next, null, 2));
  return next;
}
