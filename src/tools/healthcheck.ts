import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult, toolAnnotations, readEnvVar, messageOf } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parseStudents } from '../parse.js';

export function registerHealthcheckTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_healthcheck',
    {
      title: 'Verify Artsonia auth + connectivity',
      description: 'Confirm credentials are configured, log in, fetch the dashboard, and report {authenticated, transport, student_count} with a plain-English hint distinguishing "no creds" vs "bad creds" vs "site error". Read-only.',
      annotations: toolAnnotations({ title: 'Verify Artsonia auth + connectivity', readOnly: true, idempotent: true, openWorld: true }),
      inputSchema: {},
    },
    async () => {
      const transport = readEnvVar('ARTSONIA_TRANSPORT') ?? 'fetch';
      try {
        const students = parseStudents(await client.fetchHtml('/members/'));
        return textResult({
          ok: true,
          authenticated: true,
          transport,
          student_count: students.length,
          hint: students.length > 0 ? 'Logged in; dashboard parsed successfully.' : 'Logged in, but no students parsed — the dashboard markup may have changed.',
        });
      } catch (e) {
        const msg = messageOf(e);
        const noCreds = /ARTSONIA_USERNAME|ARTSONIA_PASSWORD/.test(msg);
        return textResult({
          ok: false,
          authenticated: false,
          transport,
          error: msg,
          hint: noCreds
            ? 'Set ARTSONIA_USERNAME and ARTSONIA_PASSWORD (in .env or the MCP host env), then retry.'
            : 'Login or fetch failed — check that your credentials are correct and the account is a parent/fan account (magic-link-only accounts are unsupported).',
        });
      }
    },
  );
}
