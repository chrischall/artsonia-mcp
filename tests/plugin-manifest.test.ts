import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Claude Code reads the plugin's MCP config from `mcpServers`. A key named
// `mcp` is silently ignored ("Unknown field 'mcp'" in `claude plugin
// validate`); it only appeared to work here because ./.mcp.json is the default
// location anyway. Sibling repos that copied `mcp` with a non-default path
// shipped plugins with no MCP server at all.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = JSON.parse(
  readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'),
) as Record<string, unknown>;

describe('.claude-plugin/plugin.json', () => {
  it('declares its MCP config under mcpServers, not the ignored mcp key', () => {
    expect(plugin).not.toHaveProperty('mcp');
    expect(typeof plugin.mcpServers).toBe('string');
  });

  it('points mcpServers at a file that exists', () => {
    const target = join(ROOT, plugin.mcpServers as string);
    expect(existsSync(target), `${plugin.mcpServers as string} is missing`).toBe(true);
  });
});
