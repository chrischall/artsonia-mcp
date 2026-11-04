import { describe, it, expect, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { createTestHarness } from '../helpers.js';
import { client } from '../../src/client.js';
import { registerHealthcheckTools } from '../../src/tools/healthcheck.js';
import { registerStudentTools } from '../../src/tools/students.js';
import { registerPortfolioTools } from '../../src/tools/portfolio.js';
import { registerFanTools } from '../../src/tools/fans.js';
import { registerFeedbackTools } from '../../src/tools/feedback.js';
import { registerAccountTools } from '../../src/tools/account.js';
import { registerDownloadTools } from '../../src/tools/download.js';
import { NodeDownloadIO } from '../../src/tools/download-io.js';
import { registerWriteTools } from '../../src/tools/writes.js';
import type { StudentDirectory } from '../../src/tools/student-directory.js';

/**
 * Context-group hints (`_meta.mint`, the mcp-host context-groups contract),
 * asserted against the SERVED tool list — what a host actually reads.
 */
const DOMAINS = ['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food'];
const INTENTS = ['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'];
const CANONICAL_INTENTS = ['whats-new', 'whats-due', 'whats-on'];
const KEYS = ['domain', 'intent', 'canonical', 'subject', 'when', 'aliases'];

/** The intent every tool declares — this table is the assertion. */
const EXPECTED_INTENT: Record<string, string> = {
  artsonia_list_students: 'lookup',
  artsonia_get_activity: 'whats-new',
  artsonia_get_portfolio: 'lookup',
  artsonia_get_artwork: 'lookup',
  artsonia_list_comments: 'lookup',
  artsonia_get_feedback: 'whats-new',
  artsonia_mark_feedback_read: 'change',
  artsonia_get_fans: 'lookup',
  artsonia_get_awards: 'lookup',
  artsonia_get_profile: 'lookup',
  artsonia_download_artwork: 'other',
  artsonia_post_comment: 'send',
  artsonia_invite_fan: 'send',
  artsonia_set_notifications: 'change',
};

/** Two synthetic students — no real names. */
const DIRECTORY: StudentDirectory = {
  labels: ['Student A', 'Student B'],
  resolve: (v) => v,
};

type Tool = {
  name: string;
  _meta?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  inputSchema: { properties?: Record<string, Record<string, unknown>> };
};

const harnesses: Array<{ close: () => Promise<void> }> = [];
afterAll(async () => { for (const h of harnesses) await h.close(); });

async function servedTools(students: StudentDirectory | null): Promise<Tool[]> {
  const h = await createTestHarness((s) => {
    registerHealthcheckTools(s, client);
    registerStudentTools(s, client);
    registerPortfolioTools(s, client);
    registerFanTools(s, client);
    registerFeedbackTools(s, client, students);
    registerAccountTools(s, client);
    registerDownloadTools(s, client, () => new NodeDownloadIO([tmpdir()]));
    registerWriteTools(s, client);
  });
  harnesses.push(h);
  return (await h.client.listTools()).tools as unknown as Tool[];
}

const mintOf = (t: Tool) => t._meta?.mint as Record<string, unknown> | undefined;

describe('_meta.mint on the served tool list', () => {
  it('names every served tool, so a new tool cannot skip the decision', async () => {
    const names = (await servedTools(DIRECTORY)).map((t) => t.name).sort();
    expect(names).toEqual([...Object.keys(EXPECTED_INTENT), 'artsonia_healthcheck'].sort());
  });

  it('every tool except the healthcheck declares domain school and its intent', async () => {
    for (const tool of await servedTools(DIRECTORY)) {
      if (tool.name === 'artsonia_healthcheck') {
        expect(mintOf(tool), tool.name).toBeUndefined();
        continue;
      }
      const mint = mintOf(tool)!;
      expect(mint, tool.name).toBeDefined();
      expect(mint.domain, tool.name).toBe('school');
      expect(mint.intent, tool.name).toBe(EXPECTED_INTENT[tool.name]);
    }
  });

  it('every hint is shaped per the host contract', async () => {
    for (const tool of await servedTools(DIRECTORY)) {
      const mint = mintOf(tool);
      if (!mint) continue;
      const props = tool.inputSchema.properties ?? {};
      expect(Object.keys(mint).filter((k) => !KEYS.includes(k)), tool.name).toEqual([]);
      expect(DOMAINS, tool.name).toContain(mint.domain);
      expect(INTENTS, tool.name).toContain(mint.intent);
      if ('canonical' in mint) {
        expect(mint.canonical, tool.name).toBe(true);
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
        expect(CANONICAL_INTENTS, tool.name).toContain(mint.intent);
      }
      if ('subject' in mint) expect(props, tool.name).toHaveProperty(mint.subject as string);
      if ('when' in mint) {
        const when = mint.when as Record<string, string>;
        expect(Object.keys(when).sort(), tool.name).toEqual(['end', 'start']);
        expect(props, tool.name).toHaveProperty(when.start);
        expect(props, tool.name).toHaveProperty(when.end);
      }
      if ('aliases' in mint) {
        const aliases = mint.aliases as string[];
        expect(aliases.length, tool.name).toBeLessThanOrEqual(8);
        for (const a of aliases) {
          expect(a.length, tool.name).toBeLessThanOrEqual(40);
          expect(a, tool.name).toBe(a.toLowerCase());
        }
      }
    }
  });

  it('marks at most one canonical read per intent: teacher feedback for whats-new', async () => {
    const canonical = (await servedTools(DIRECTORY))
      .filter((t) => mintOf(t)?.canonical === true)
      .map((t) => [t.name, mintOf(t)!.intent]);
    expect(canonical).toEqual([['artsonia_get_feedback', 'whats-new']]);
  });

  it('the canonical read takes view: brief and names artist_id as its subject', async () => {
    const tool = (await servedTools(DIRECTORY)).find((t) => t.name === 'artsonia_get_feedback')!;
    expect(mintOf(tool)).toEqual({
      domain: 'school',
      intent: 'whats-new',
      canonical: true,
      subject: 'artist_id',
      aliases: ['art', 'art teacher', 'art class', 'artwork', 'artsonia', 'teacher feedback'],
    });
    expect(tool.inputSchema.properties?.view?.enum).toEqual(['full', 'brief']);
  });

  it('publishes the student labels as the subject enum when the students were listed at start', async () => {
    const tool = (await servedTools(DIRECTORY)).find((t) => t.name === 'artsonia_get_feedback')!;
    expect(tool.inputSchema.properties?.artist_id?.enum).toEqual(['Student A', 'Student B']);
  });

  it('publishes no enum keyword (never an empty one) when the students could not be listed', async () => {
    const tool = (await servedTools(null)).find((t) => t.name === 'artsonia_get_feedback')!;
    expect(tool.inputSchema.properties?.artist_id).toBeDefined();
    expect(tool.inputSchema.properties?.artist_id).not.toHaveProperty('enum');
  });
});
