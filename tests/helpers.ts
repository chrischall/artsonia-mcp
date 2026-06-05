import { createTestHarness as _createTestHarness } from '@chrischall/mcp-utils/test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Re-export createTestHarness with a callTool wrapper that drains the
// macrotask queue (via setImmediate) before dispatching the MCP request.
// This ensures any pending promise chains from the previous test have fully
// settled — including the spy's settled-result tracking — before the current
// test's MCP machinery runs, preventing vitest from attributing those
// rejections to the current test.
export async function createTestHarness(registerFn: (server: McpServer) => void | Promise<void>) {
  const harness = await _createTestHarness(registerFn);
  return {
    ...harness,
    callTool: async (name: string, args?: Record<string, unknown>) => {
      await new Promise<void>(resolve => setImmediate(resolve));
      return harness.callTool(name, args);
    },
  };
}
