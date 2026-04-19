import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';
import { readdir } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const omxBin = join(repoRoot, 'dist', 'cli', 'omx.js');
const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'omx-question-cli-'));
  tempDirs.push(cwd);
  await mkdir(join(cwd, '.omx', 'state', 'sessions', 'sess-q', 'questions'), { recursive: true });
  await writeFile(join(cwd, '.omx', 'state', 'session.json'), JSON.stringify({ session_id: 'sess-q' }));
  return cwd;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('omx question CLI', () => {
  it('hard-fails worker contexts before UI launch', async () => {
    const cwd = await makeRepo();
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [omxBin, 'question', '--input', JSON.stringify({
        question: 'Pick one',
        options: ['A'],
        allow_other: true,
      }), '--json'], {
        cwd,
        env: { ...process.env, OMX_TEAM_WORKER: 'demo/worker-1', OMX_AUTO_UPDATE: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

    assert.equal(result.code, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.error.code, 'worker_blocked');
    assert.deepEqual(await readdir(join(cwd, '.omx', 'state', 'sessions', 'sess-q', 'questions')), []);
  });

  it('blocks until an answer is written and returns structured payload', async () => {
    const cwd = await makeRepo();
    const input = JSON.stringify({
      question: 'Pick one',
      options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
      allow_other: true,
      source: 'deep-interview',
      type: 'multi-answerable',
      session_id: 'sess-q',
    });

    const child = spawn(process.execPath, [omxBin, 'question', '--input', input, '--json'], {
      cwd,
      env: { ...process.env, OMX_AUTO_UPDATE: '0', OMX_NOTIFY_FALLBACK: '0', OMX_HOOK_DERIVED_SIGNALS: '0', OMX_QUESTION_TEST_RENDERER: 'noop' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });

    const questionsDir = join(cwd, '.omx', 'state', 'sessions', 'sess-q', 'questions');
    let recordFile = '';
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const { readdir } = await import('node:fs/promises');
        const entries = await readdir(questionsDir);
        recordFile = entries.find((entry) => entry.endsWith('.json')) || '';
        if (recordFile) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.notEqual(recordFile, '', `expected question record file, stderr=${stderr}`);
    const recordPath = join(questionsDir, recordFile);
    const record = JSON.parse(await readFile(recordPath, 'utf-8')) as { question_id: string };
    await writeFile(recordPath, JSON.stringify({
      kind: 'omx.question/v1',
      question_id: record.question_id,
      session_id: 'sess-q',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'answered',
      question: 'Pick one',
      options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
      allow_other: true,
      other_label: 'Other',
      type: 'multi-answerable',
      multi_select: true,
      source: 'deep-interview',
      answer: {
        kind: 'other',
        value: 'free text answer',
        selected_labels: ['Other'],
        selected_values: ['free text answer'],
        other_text: 'free text answer',
      },
    }, null, 2));

    const exitCode = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.equal(exitCode, 0, stderr || stdout);
    const payload = JSON.parse(stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.answer.value, 'free text answer');
    assert.equal(payload.prompt.source, 'deep-interview');
    assert.equal(payload.prompt.type, 'multi-answerable');
  });
});
