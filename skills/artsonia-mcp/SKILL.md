---
name: artsonia-mcp
description: Access Artsonia student-art portfolios, comments, and fans via MCP. Use when the user asks about a child's artwork, wants to post an art comment, check fans, view portfolios, or manage Artsonia notifications. Triggers on phrases like "show me Emma's latest artwork", "post a comment on that painting", "who are the fans for this student", "invite grandma as a fan", or any request involving student art portfolios on Artsonia. Requires artsonia-mcp installed and the artsonia server registered (see Setup below).
---

# artsonia-mcp

MCP server for Artsonia — natural-language access to student-art portfolios, comments, and fans.

- **npm:** [npmjs.com/package/artsonia-mcp](https://www.npmjs.com/package/artsonia-mcp)
- **Source:** [github.com/chrischall/artsonia-mcp](https://github.com/chrischall/artsonia-mcp)

## Setup

### Option A — npx (recommended)

Add to `.mcp.json` in your project or `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "artsonia": {
      "command": "npx",
      "args": ["-y", "artsonia-mcp"],
      "env": {
        "ARTSONIA_USERNAME": "your-email@example.com",
        "ARTSONIA_PASSWORD": "your-password"
      }
    }
  }
}
```

### Option B — from source

```bash
git clone https://github.com/chrischall/artsonia-mcp
cd artsonia-mcp
npm install && npm run build
```

Then add to `.mcp.json`:

```json
{
  "mcpServers": {
    "artsonia": {
      "command": "node",
      "args": ["/path/to/artsonia-mcp/dist/index.js"],
      "env": {
        "ARTSONIA_USERNAME": "your-email@example.com",
        "ARTSONIA_PASSWORD": "your-password"
      }
    }
  }
}
```

Or use a `.env` file in the project directory with `ARTSONIA_USERNAME=<value>` and `ARTSONIA_PASSWORD=<value>`.

## Authentication

Username/password auth using your Artsonia parent/fan account credentials. The server logs in and maintains a session cookie.

## Tools

### Core
| Tool | Description |
|------|-------------|
| `artsonia_healthcheck` | Check connectivity and authentication status |
| `artsonia_list_students` | List all students linked to the account |

### Portfolio & Artwork
| Tool | Description |
|------|-------------|
| `artsonia_get_activity` | Get recent activity feed for a student |
| `artsonia_get_portfolio` | Get a student's art portfolio. Optional `include_details: boolean` (default `false`) fetches each artwork's full detail (title/project/grade/views/…) concurrently and merges it into the rows; omit it for the fast, lean tiles. |
| `artsonia_get_artwork` | Get details for a single artwork |
| `artsonia_download_artwork` | Download a student's artwork images to a local folder. Optional `path_template: string` (e.g. `"{grade}/{project}"` or `"{school_year}"`) organizes downloads into subfolders under `dest`, composed with `filename_template` — same tokens (`{title}` `{project}` `{grade}` `{date}` `{school_year}` `{artwork_id}`), segments slugified like filenames, empty tokens collapse, and paths stay deterministic so `skip_existing` re-runs remain idempotent. Optional `embed_metadata: boolean` (default `false`) embeds each image's title/project/grade and source date (its `Last-Modified`) into the JPEG's EXIF (ImageDescription, DateTimeOriginal) and IPTC (title, keywords, date) so the metadata survives renames/moves and is searchable in Spotlight/Apple Photos; the count is returned as `embedded_count` (best-effort — a failed embed writes the original bytes). Optional `write_index: boolean` (default `false`) writes an `index.json` manifest into the destination listing the downloaded items (`artwork_id`, `title`, `file` — dest-relative, `grade`, `project`, `date`); the manifest path is returned as `index_file`. Optional `write_metadata: boolean` (default `false`) writes a per-artwork `<image-name>.json` sidecar next to each image with the artwork's comments and teacher feedback (plus title/project/grade); the count is returned as `metadata_count`. Optional `include_private: boolean` (default `true`) — set `false` to exclude private pieces (`private_excluded_count` reports how many were dropped). The result carries totals (`total_bytes`, `downloaded_count`/`skipped_count`/`failed_count`/`private_count`), a per-file `is_private` flag, and — on unfiltered runs — a `count_check` against the student's `artwork_count` with a `warning` when the pull looks partial. The dry run (no `confirm`) adds `estimated_bytes` per item and `estimated_total_bytes`. |

### Social
| Tool | Description |
|------|-------------|
| `artsonia_list_comments` | List comments on an artwork |
| `artsonia_get_fans` | Get the fan list for a student |
| `artsonia_post_comment` | Post a comment on an artwork |
| `artsonia_invite_fan` | Invite someone to become a fan of a student |
| `artsonia_set_notifications` | Update notification preferences for a student |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ARTSONIA_USERNAME` | Yes | Your Artsonia login email address |
| `ARTSONIA_PASSWORD` | Yes | Your Artsonia account password |
| `ARTSONIA_TRANSPORT` | No | Override transport: `stdio` (default), `sse`, or `fetchproxy` |
| `ARTSONIA_WS_PORT` | No | WebSocket port when using `sse` transport |
| `ARTSONIA_INLINE_DOWNLOADS` | No | Set to `1` on a hosted deployment to return `artsonia_download_artwork` images as inline base64 blocks instead of writing them to a disk the user can't reach. Leave unset for local installs. |
| `ARTSONIA_SESSION_CACHE` | No | Set to `false` to disable the on-disk session cache and log in on every start. Defaults to enabled (direct transport only). |
| `ARTSONIA_SESSION_FILE` | No | Override the session cache path. Defaults to `$MCP_DATA_DIR/.artsonia-mcp/session-<user>.json` — one file per user, so per-credential clients do not clobber each other. |
