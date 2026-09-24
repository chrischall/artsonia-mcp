import { afterEach } from 'vitest';
import type { TestHarness } from '@chrischall/mcp-utils/test';

export { createTestHarness } from '@chrischall/mcp-utils/test';

/** Parse a tool result's first text block as JSON. */
export const parseResult = (res: any) => JSON.parse(res.content[0].text);

/** A client that CAN be prompted and says yes. */
export const ACCEPT = { elicitation: async () => ({ action: 'accept' as const, content: { confirmed: true } }) };
/** A client that CAN be prompted and says no. */
export const DECLINE = { elicitation: async () => ({ action: 'decline' as const }) };

/**
 * Snapshot the MCP_CONFIRM_* env and restore it after every test in the file,
 * so a test that flips MCP_CONFIRM_MODE cannot leak into the next one.
 */
export function restoreConfirmEnvAfterEach(): void {
  const keys = ['MCP_CONFIRM_MODE', 'MCP_CONFIRM_TTL_SECONDS', 'MCP_CONFIRM_SECRET'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

/**
 * Phase 1 of the confirm-token flow on a harness that cannot be prompted:
 * asserts the call stopped at "confirmation-required" and returns that response
 * (its `preview` and `confirmToken`).
 */
export async function phaseOne(harness: TestHarness, name: string, args: Record<string, unknown>) {
  const out = parseResult(await harness.callTool(name, args));
  if (out.status !== 'confirmation-required') {
    throw new Error(`expected ${name} to stop at confirmation-required, got ${JSON.stringify(out)}`);
  }
  return out;
}

/** Both phases: preview, then the same call with the returned token. Returns phase 2's raw result. */
export async function callConfirmed(harness: TestHarness, name: string, args: Record<string, unknown>) {
  const { confirmToken } = await phaseOne(harness, name, args);
  return harness.callTool(name, { ...args, confirmToken });
}
