# Artsonia endpoint capture (parent/fan role)

Captured live 2026-06-05 from a signed-in parent session via Chrome.
**Shapes only — no cookies/tokens/PII committed.**

Artsonia is a **classic server-rendered jQuery `.asp` site** (jQuery 3.7.1,
jQuery UI, blockUI, sweetalert, js.cookie). No SPA framework, no JSON store,
no JSON API for these pages — **data lives in the server-rendered HTML**, so
the MCP parses HTML with `node-html-parser`. No Cloudflare interstitial
observed. Auth is the session cookie carried by the browser; **no CSRF /
`__VIEWSTATE` token** on any form.

Identifiers:
- **artistId** (a child/student), e.g. `16011097` (Finn), `13447141` (Lucas).
  Source: `portfolio.asp?id=<artistId>` and `?artist=<artistId>` params.
- **artworkId** (numeric), e.g. `150567537`. Source: `art.asp?id=<artworkId>`.
  Thumbnail: `https://images.artsonia.com/art/small/<artworkId>.jpg`.

## Reads (GET, server-rendered HTML)

| Tool | Path | Parse target |
|------|------|--------------|
| list_students | `/members/` | `.artist-card` → artistId (from `portfolio.asp?id=`), name, school, grade, counts (artworks/fans/comments/feedback/awards) |
| get_activity / notifications | `/members/` | Notifications section (count + items) |
| get_portfolio | `/artists/portfolio.asp?id=<artistId>` | `.grid-item` → artworkId (from `art.asp?id=`), title, `private-art` flag, thumbnail |
| get_artwork | `/museum/art.asp?id=<artworkId>` | title (page `<title>`), artist screen-name, view count, keepsakes, comment link |
| list_comments | `/members/comments/?artist=<artistId>` | comments list (empty state when 0) |
| get_fans | `/members/fanclub/?artist=<artistId>` | `.fan-card` / `.fan-row` → fan name, relationship |
| get_feedback (bonus) | `/members/feedback/?artist=<artistId>` | teacher feedback |

## Writes (POST, `application/x-www-form-urlencoded`, session-cookie auth, no CSRF)

### post_comment — BUILD NOW ✅
- Form `CommentForm` (`#Form1`) served by GET
  `/members/comments/enter.asp?artist=<artistId>&art=<artworkId>`.
- Submits as a plain form POST (`$("#Form1").submit()`, no AJAX) to:
  - **`POST /museum/enter.asp?artist=<artistId>&art=<artworkId>`**
  - Body: **`Comment=<text>`** (single field). No hidden/token fields.

### invite_fan — verifiable ✅ (isolated form)
- Form `#TheForm` served by GET `/members/fanclub/add.asp?artist=<artistId>`.
- **`POST /members/fanclub/add.asp?artist=<artistId>`**
- Fields: `MemberType` (hidden), `RelationshipID` (select), `IsParent`
  (checkbox), `FirstName`, `LastName`, `EmailAddress`, `OwnerMode` (checkbox),
  `ArtistID` (hidden; plus per-artist checkboxes to invite to multiple kids'
  fan clubs). Sends an invite email — test only to `@example.com`.

### set_notifications — verifiable but RISKY ⚠️
- Opt-ins live inside the **master profile form** `ParentProfileForm`
  (`#TheForm`) at GET `/members/profile/`, posting to
  **`POST /members/profile/default.asp`**.
- Same form ALSO carries `FirstName`, `LastName`, `EmailAddress`,
  `EmailAddressPrev` (hidden), `OldPassword`/`NewPassword`/`NewPassword2`,
  `DidChangePassword` (hidden), `MobileCountryCode`/`MobileNumber`,
  `Action` (hidden), `VerificationCode` (hidden).
- Notification toggles: `OptInNews`, `OptInArtistActivity` (default checked),
  `OptInPromos` (checkboxes; HTML omits unchecked → presence = on).
- Toggling requires read-modify-write of the WHOLE profile (re-send all
  current values, flip only the opt-in, leave password fields blank /
  `DidChangePassword=0`). Bundles PII + email-change/password logic.
  **Design decision pending** (see spec) — may ship as read-only status
  instead.

### star_artwork — NOT AVAILABLE ❌
- No star/applause/favorite control or endpoint exists on the artwork page
  for the parent role (`starInHtml: false`, no star endpoints). Dropped per
  the verify-then-ship rule.
