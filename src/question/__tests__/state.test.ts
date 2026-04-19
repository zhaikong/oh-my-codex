import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  createQuestionRecord,
  getQuestionRecordPath,
  markQuestionAnswered,
  readQuestionRecord,
  waitForQuestionTerminalState,
} from '../state.js';

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'omx-question-state-'));
  tempDirs.push(cwd);
  return cwd;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('question state', () => {
  it('creates records under session-scoped question state and reads them back', async () => {
    const cwd = await makeRepo();
    const { record, recordPath } = await createQuestionRecord(cwd, {
      question: 'Pick one',
      options: [{ label: 'A', value: 'a' }],
      allow_other: true,
      other_label: 'Other',
      multi_select: false,
    }, 'sess-1');

    assert.equal(recordPath, getQuestionRecordPath(cwd, record.question_id, 'sess-1'));
    const loaded = await readQuestionRecord(recordPath);
    assert.equal(loaded?.question, 'Pick one');
    assert.equal(loaded?.type, 'single-answerable');
  });

  it('waits for terminal answered state and returns free-text other values exactly', async () => {
    const cwd = await makeRepo();
    const { recordPath } = await createQuestionRecord(cwd, {
      question: 'Pick one',
      options: [{ label: 'A', value: 'a' }],
      allow_other: true,
      other_label: 'Other',
      multi_select: false,
    }, 'sess-2');

    const waiter = waitForQuestionTerminalState(recordPath, { pollIntervalMs: 10, timeoutMs: 2000 });
    setTimeout(() => {
      void markQuestionAnswered(recordPath, {
        kind: 'other',
        value: 'custom text',
        selected_labels: ['Other'],
        selected_values: ['custom text'],
        other_text: 'custom text',
      });
    }, 50);

    const finalRecord = await waiter;
    assert.equal(finalRecord.answer?.value, 'custom text');
    assert.equal(finalRecord.status, 'answered');
  });
});
