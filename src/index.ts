#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION } from './version.js';
import { client } from './client.js';
import { registerHealthcheckTools } from './tools/healthcheck.js';
import { registerStudentTools } from './tools/students.js';
import { registerPortfolioTools } from './tools/portfolio.js';
import { registerFanTools } from './tools/fans.js';
import { registerWriteTools } from './tools/writes.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// The client is a module-level singleton (constructed in client.ts) so the
// deferred-config-error pattern holds: the server boots and answers the host's
// install-time tools/list probe even without ARTSONIA_USERNAME/PASSWORD — the
// config error only surfaces on the first tool call.
const tools: Array<(server: McpServer) => void> = [
  (s) => registerHealthcheckTools(s, client),
  (s) => registerStudentTools(s, client),
  (s) => registerPortfolioTools(s, client),
  (s) => registerFanTools(s, client),
  (s) => registerWriteTools(s, client),
];

await runMcp({
  name: 'artsonia-mcp',
  version: VERSION,
  banner: `[artsonia-mcp] v${VERSION} — parent/fan access to Artsonia via username/password login. This project was developed and is maintained by AI (Claude). Use at your own discretion.`,
  tools,
});
