import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// The .mcpb manifest is hand-maintained, so it drifts: it once listed 10 of 15
// tools (hiding the file-writing download tool from the install page) and
// declared a transport option that was never wired into the server env.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as {
  server: { mcp_config: { env: Record<string, string> } };
  user_config: Record<string, unknown>;
  tools: { name: string; description: string }[];
};

let harness: Awaited<ReturnType<typeof createTestHarness>>;
afterAll(async () => { if (harness) await harness.close(); });

describe('manifest.json', () => {
  it('lists exactly the tools the server registers', async () => {
    harness = await createTestHarness((s) => {
      registerHealthcheckTools(s, client);
      registerStudentTools(s, client);
      registerPortfolioTools(s, client);
      registerFanTools(s, client);
      registerFeedbackTools(s, client);
      registerAccountTools(s, client);
      registerDownloadTools(s, client, () => new NodeDownloadIO());
      registerWriteTools(s, client);
    });
    const registered = (await harness.listTools()).map((t) => t.name).sort();
    const declared = manifest.tools.map((t) => t.name).sort();
    expect(declared).toEqual(registered);
    for (const t of manifest.tools) expect(t.description.trim()).not.toBe('');
  });

  it('wires every user_config option into the server env', () => {
    const env = JSON.stringify(manifest.server.mcp_config.env);
    for (const key of Object.keys(manifest.user_config)) {
      expect(env, `user_config.${key} is declared but never reaches the server`).toContain(
        `\${user_config.${key}}`,
      );
    }
  });
});
