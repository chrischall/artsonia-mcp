import { describe, it, expect, afterAll } from 'vitest';
import { createTestHarness } from './helpers.js';
import { client } from '../src/client.js';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import { registerStudentTools } from '../src/tools/students.js';
import { registerPortfolioTools } from '../src/tools/portfolio.js';
import { registerFanTools } from '../src/tools/fans.js';
import { registerWriteTools } from '../src/tools/writes.js';

let harness: Awaited<ReturnType<typeof createTestHarness>>;
afterAll(async () => { if (harness) await harness.close(); });

describe('full tool surface', () => {
  it('registers all 10 tools', async () => {
    harness = await createTestHarness((s) => {
      registerHealthcheckTools(s, client);
      registerStudentTools(s, client);
      registerPortfolioTools(s, client);
      registerFanTools(s, client);
      registerWriteTools(s, client);
    });
    const names = (await harness.listTools()).map((t) => t.name).sort();
    expect(names).toEqual([
      'artsonia_get_activity',
      'artsonia_get_artwork',
      'artsonia_get_fans',
      'artsonia_get_portfolio',
      'artsonia_healthcheck',
      'artsonia_invite_fan',
      'artsonia_list_comments',
      'artsonia_list_students',
      'artsonia_post_comment',
      'artsonia_set_notifications',
    ]);
  });
});
