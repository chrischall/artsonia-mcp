# artsonia-mcp

[![CI](https://github.com/chrischall/artsonia-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischall/artsonia-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/artsonia-mcp)](https://www.npmjs.com/package/artsonia-mcp)
[![license](https://img.shields.io/npm/l/artsonia-mcp)](LICENSE)

Artsonia MCP server for Claude — developed and maintained by AI (Claude Code)

## Confirmations

Every write — posting a comment, inviting a fan, changing notification settings, marking feedback read, and downloading artwork to disk — asks you to confirm it first. A client that can show a confirmation prompt (Claude Code) shows one. A client that cannot (claude.ai, Claude Desktop) gets a two-step flow instead: the first call changes nothing and returns a preview of exactly what would be sent or written plus a `confirmToken`; only a second, identical call carrying that token goes ahead. The token is single-use, expires, and is refused if anything changed between the two calls.

| variable | default | |
|---|---|---|
| `MCP_CONFIRM_MODE` | `ask-user` | What a write does on a client that cannot show a confirmation prompt (claude.ai, Claude Desktop). `ask-user`: two steps — the first call does nothing and returns a preview plus a token, and the model must get your approval in chat before calling again with it. `auto`: the same two steps, but the model may use the token after reviewing the preview itself. `refuse`: writes are refused on such clients. A client that can show prompts (Claude Code) always gets the real prompt. An unrecognised value is treated as `refuse`. |
| `MCP_CONFIRM_TTL_SECONDS` | `600` | How long a token stays valid. |
| `MCP_CONFIRM_SECRET` | random per process | Signing key; set it only if tokens must survive a server restart. |
