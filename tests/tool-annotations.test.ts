import { tmpdir } from 'node:os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness } from './helpers.js';
import { client } from '../src/client.js';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import { registerStudentTools } from '../src/tools/students.js';
import { registerPortfolioTools } from '../src/tools/portfolio.js';
import { registerFanTools } from '../src/tools/fans.js';
import { registerFeedbackTools } from '../src/tools/feedback.js';
import { registerAccountTools } from '../src/tools/account.js';
import { registerDownloadTools } from '../src/tools/download.js';
import { NodeDownloadIO } from '../src/tools/download-io.js';
import { registerWriteTools } from '../src/tools/writes.js';

/**
 * Fleet annotation meta-test. `destructiveHint` DEFAULTS TO TRUE whenever
 * readOnlyHint is false, so a write that forgets to declare it publishes as
 * destructive and nothing fails — a considered `false` and a forgotten one
 * leave identical annotations. So every write must CHOOSE, and no read may
 * claim to be destructive. Reads the annotations off the wire (tools/list),
 * not a hand-kept list.
 */
interface Ann { readOnlyHint?: unknown; destructiveHint?: unknown; openWorldHint?: unknown }

let harness: Awaited<ReturnType<typeof createTestHarness>>;
let ann: Record<string, Ann | undefined>;

beforeAll(async () => {
  harness = await createTestHarness((s) => {
    registerHealthcheckTools(s, client);
    registerStudentTools(s, client);
    registerPortfolioTools(s, client);
    registerFanTools(s, client);
    registerFeedbackTools(s, client);
    registerAccountTools(s, client);
    registerDownloadTools(s, client, () => new NodeDownloadIO([tmpdir()]));
    registerWriteTools(s, client);
  });
  ann = Object.fromEntries((await harness.client.listTools()).tools.map((t) => [t.name, t.annotations as Ann | undefined]));
});
afterAll(async () => { if (harness) await harness.close(); });

describe('tool annotations', () => {
  it('covers the full surface (guards against a registrar being dropped here)', () => {
    expect(Object.keys(ann)).toHaveLength(15);
  });

  it('sets an explicit boolean readOnlyHint on every tool', () => {
    expect(Object.entries(ann).filter(([, a]) => typeof a?.readOnlyHint !== 'boolean').map(([n]) => n)).toEqual([]);
  });

  it('sets an explicit boolean destructiveHint on every write', () => {
    const undeclared = Object.entries(ann)
      .filter(([, a]) => a?.readOnlyHint === false && typeof a?.destructiveHint !== 'boolean')
      .map(([n]) => n);
    expect(undeclared).toEqual([]);
  });

  it('never lets a read claim to be destructive', () => {
    const contradictory = Object.entries(ann)
      .filter(([, a]) => a?.readOnlyHint === true && a?.destructiveHint === true)
      .map(([n]) => n);
    expect(contradictory).toEqual([]);
  });

  it('marks every tool open-world (all of them talk to artsonia.com)', () => {
    expect(Object.entries(ann).filter(([, a]) => a?.openWorldHint !== true).map(([n]) => n)).toEqual([]);
  });

  it('classifies the writes by the inverse test', () => {
    // destructive:false only when a later call in THIS tool set restores the
    // prior state. set_notifications is its own inverse (flip the opt-in back).
    // mark_feedback_read has no mark-unread anywhere (and marks ALL feedback);
    // post_comment has no delete; invite_fan emails another person;
    // download_artwork can overwrite existing files.
    const writes = Object.fromEntries(
      Object.entries(ann).filter(([, a]) => a?.readOnlyHint === false).map(([n, a]) => [n, a?.destructiveHint]),
    );
    expect(writes).toEqual({
      artsonia_mark_feedback_read: true,
      artsonia_download_artwork: true,
      artsonia_post_comment: true,
      artsonia_invite_fan: true,
      artsonia_set_notifications: false,
    });
  });
});
