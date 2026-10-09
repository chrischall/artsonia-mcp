// Tools that return text written by other people (fan comments, teacher
// feedback, fan names, dashboard notices, artwork titles) fence it as untrusted
// data (chrischall/fleet-audit#366): the result leads with an
// `untrusted_content` marker + note, and the tool description warns up front.
import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest';
import { UNTRUSTED_DESCRIPTION_SUFFIX } from '@chrischall/mcp-utils';
import { client } from '../../src/client.js';
import { registerPortfolioTools } from '../../src/tools/portfolio.js';
import { registerFanTools } from '../../src/tools/fans.js';
import { registerFeedbackTools } from '../../src/tools/feedback.js';
import { registerStudentTools } from '../../src/tools/students.js';
import { createTestHarness, parseResult as parse } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fx = (n: string) => readFileSync(join(FIX, n), 'utf8');
const PAGES: Record<string, string> = {
  '/artists/portfolio.asp': fx('portfolio.html'),
  '/museum/art.asp': fx('artwork.html'),
  '/members/fanclub/': fx('fans.html'),
  '/members/feedback/': fx('feedback.html'),
  '/members/': fx('dashboard.html'),
};
vi.spyOn(client, 'fetchHtml').mockImplementation(async (path: string) => {
  const key = Object.keys(PAGES).find((k) => path.startsWith(k + '?') || path === k);
  return key ? PAGES[key] : '';
});

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeAll(async () => {
  harness = await createTestHarness((s) => {
    registerPortfolioTools(s, client);
    registerFanTools(s, client);
    registerFeedbackTools(s, client);
    registerStudentTools(s, client);
  });
});
afterAll(async () => { await harness.close(); });

const FENCED: Array<[string, Record<string, unknown>]> = [
  ['artsonia_get_artwork', { artwork_id: '150567537' }],
  ['artsonia_list_comments', { artwork_id: '150567537' }],
  ['artsonia_get_fans', { artist_id: '13447141' }],
  ['artsonia_get_feedback', { artist_id: '13447141' }],
  ['artsonia_get_activity', {}],
  ['artsonia_get_portfolio', { artist_id: '13447141', include_details: true }],
];

describe('third-party text is fenced as untrusted data', () => {
  for (const [name, args] of FENCED) {
    it(`${name} leads its result with the untrusted marker`, async () => {
      const res = await harness.callTool(name, args);
      const text = (res.content[0] as { text: string }).text;
      expect(text.startsWith('{"untrusted_content":true,"note":')).toBe(true);
      expect(parse(res).untrusted_content).toBe(true);
    });
    it(`${name} warns in its description`, async () => {
      const tool = (await harness.listTools()).find((t) => t.name === name)!;
      expect(tool.description).toContain(UNTRUSTED_DESCRIPTION_SUFFIX);
    });
  }

  it('the lean portfolio (ids + thumbnails only) carries no fence', async () => {
    const out = parse(await harness.callTool('artsonia_get_portfolio', { artist_id: '13447141' }));
    expect(out.untrusted_content).toBeUndefined();
  });
});
