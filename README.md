# artsonia-mcp

[![CI](https://github.com/chrischall/artsonia-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischall/artsonia-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/artsonia-mcp)](https://www.npmjs.com/package/artsonia-mcp)
[![license](https://img.shields.io/npm/l/artsonia-mcp)](LICENSE)

Artsonia MCP server for Claude — developed and maintained by AI (Claude Code)

## Download folders

`artsonia_download_artwork` saves images only inside an allowed folder; any other `dest` is refused before anything is fetched or written, and no file is ever written through a symlink.

| variable | default | |
|---|---|---|
| `ARTSONIA_OUTPUT_DIR` | `~/Downloads` and `~/Pictures` | The folders `dest` must be inside (subfolders are fine and are created). Several folders: separate them with `:` (`;` on Windows). On a hosted server (`MCP_DATA_DIR` or `MCP_BLOB_BASE_URL` set), or with `ARTSONIA_INLINE_DOWNLOADS=1`, nothing is written to disk, so `dest` is only a label and is not checked: images come back inline up to 10 MiB per result, the rest as one signed zip link when the host has a blob store, and anything that still cannot be delivered is listed by name with the reason. |

## Upgrading

### next release

`artsonia_download_artwork` no longer drops or strands an image. What changed in its result:

- **Hosted servers never write to disk.** With `MCP_DATA_DIR` or `MCP_BLOB_BASE_URL` set, downloads now behave as if `ARTSONIA_INLINE_DOWNLOADS=1` were set, whatever that variable says. Before, a hosted server without it saved into `$MCP_DATA_DIR/downloads` and reported files nobody could open.
- **New `archive`** (only when used): `{ url, expires_at, file_count, bytes, archive_bytes }`. On a hosted server with a blob store, the images that do not fit inline (10 MiB per result) go into one zip behind that signed link. They count as downloaded.
- **`downloaded[]` entries gain `delivered_via`** on the inline path: `"inline"`, `"archive"` (plus `archive_file`, its path in the zip) or `"link"` (plus `url` and `expires_at`, for a single image too big to inline). Disk downloads are unchanged.
- **`omitted[]` entries were `{ artwork_id, bytes, is_private }`.** They are now `{ artwork_id, name, bytes, reason, title?, is_private }`. `name` is the file name the image would have had, and `reason` says why it was not delivered. An image whose zip upload failed is moved here from `downloaded`.
- **`failed[]` entries gain `title`** when the artwork's detail page was read.


The writes that reach other people — posting a comment and inviting a fan — ask you to confirm them first. Changing your notification settings, marking feedback read, and downloading artwork into your allowed download folders run straight away. A client that can show a confirmation prompt (Claude Code) shows one. A client that cannot (claude.ai, Claude Desktop) gets a two-step flow instead: the first call changes nothing and returns a preview of exactly what would be sent plus a `confirmToken`; only a second, identical call carrying that token goes ahead. The token is single-use, expires, and is refused if anything changed between the two calls.

| variable | default | |
|---|---|---|
| `MCP_CONFIRM_MODE` | `ask-user` | What a write does on a client that cannot show a confirmation prompt (claude.ai, Claude Desktop). `ask-user`: two steps — the first call does nothing and returns a preview plus a token, and the model must get your approval in chat before calling again with it. `auto`: the same two steps, but the model may use the token after reviewing the preview itself. `refuse`: writes are refused on such clients. A client that can show prompts (Claude Code) always gets the real prompt, unless `MCP_CONFIRM_ELICITATION=off`. An unrecognised value is treated as `refuse`. |
| `MCP_CONFIRM_ELICITATION` | `on` | `off` never shows a confirmation prompt, so every client gets the `MCP_CONFIRM_MODE` path. Set it for a client that claims to support prompts but never shows one (the write hangs — opencode 2.0.x). Any other value stays `on`, with a warning on stderr. |
| `MCP_CONFIRM_TTL_SECONDS` | `600` | How long a token stays valid. |
| `MCP_CONFIRM_SECRET` | random per process | Signing key; set it only if tokens must survive a server restart. |
