#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION } from './version.js';
import { client } from './client.js';
import { registerHealthcheckTools } from './tools/healthcheck.js';
import { registerStudentTools } from './tools/students.js';
import { registerPortfolioTools } from './tools/portfolio.js';
import { registerFanTools } from './tools/fans.js';
import { registerFeedbackTools } from './tools/feedback.js';
import { registerAccountTools } from './tools/account.js';
import { registerDownloadTools } from './tools/download.js';
import { makeDownloadIO } from './tools/make-download-io.js';
import { registerWriteTools } from './tools/writes.js';
import { loadStudentDirectory } from './tools/student-directory.js';
import type { McpServer } from '@modelcontextprotocol/server';

// The client is a module-level singleton (constructed in client.ts) so the
// deferred-config-error pattern holds: the server boots and answers the host's
// install-time tools/list probe even without ARTSONIA_USERNAME/PASSWORD — the
// config error only surfaces on the first tool call.
// The canonical feedback read's `artist_id` publishes the followed students'
// names as an enum (context groups, mcp-host spec 2026-11-03 D5), so list them
// ONCE here — registrars run per served instance — bounded by
// STUDENT_LIST_TIMEOUT_MS. Null (no creds yet, no browser, nobody followed,
// timeout) publishes the property with no enum; it never throws, so the
// deferred-config-error boot still holds.
const students = await loadStudentDirectory(client);

const tools: Array<(server: McpServer) => void> = [
  (s) => registerHealthcheckTools(s, client),
  (s) => registerStudentTools(s, client),
  (s) => registerPortfolioTools(s, client),
  (s) => registerFanTools(s, client),
  (s) => registerFeedbackTools(s, client, students),
  (s) => registerAccountTools(s, client),
  (s) => registerDownloadTools(s, client, makeDownloadIO),
  (s) => registerWriteTools(s, client),
];

await runMcp({
  name: 'artsonia-mcp',
  version: VERSION,
  banner: `[artsonia-mcp] v${VERSION} — parent/fan access to Artsonia via username/password login. This project was developed and is maintained by AI (Claude). Use at your own discretion.`,
  tools,
});
