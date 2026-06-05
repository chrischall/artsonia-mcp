import { parse, NodeType, type HTMLElement } from 'node-html-parser';

const firstIntIn = (s: string | undefined): number | null => {
  const m = (s ?? '').match(/(\d[\d,]*)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};
const text = (el: HTMLElement | null): string => (el ? el.text.replace(/\s+/g, ' ').trim() : '');
const attrId = (href: string | undefined, key: string): string | null => {
  const m = (href ?? '').match(new RegExp(`[?&](?:amp;)?${key}=(\\d+)`));
  return m ? m[1] : null;
};

/** Returns the direct text-node content of an element (excludes child element text). */
const ownText = (el: HTMLElement): string =>
  el.childNodes
    .filter((n) => n.nodeType === NodeType.TEXT_NODE)
    .map((n) => n.rawText)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

export interface Student {
  artist_id: string;
  name: string;
  school: string;
  grade: string | null;
  artwork_count: number | null;
  fan_count: number | null;
  comment_count: number | null;
  feedback_count: number | null;
  award_count: number | null;
  portfolio_path: string;
}

export function parseStudents(html: string): Student[] {
  const root = parse(html);
  return root.querySelectorAll('.artist-card').map((card): Student | null => {
    const link = card.querySelector('a[href*="portfolio.asp"]');
    const href = link?.getAttribute('href');
    const artist_id = attrId(href, 'id');
    if (!artist_id) return null;

    // Name: first a.lightlink text
    const name = text(card.querySelector('a.lightlink'));

    // School/grade: child div whose text matches "Currently at"
    const schoolDiv = card.querySelectorAll('div').find((d) =>
      d.text.includes('Currently at'),
    ) ?? null;
    const schoolText = text(schoolDiv);
    const schoolMatch = schoolText.match(/Currently at (.+?) \(Grade/);
    const gradeMatch = schoolText.match(/\(Grade\s+(\w+)\)/i);
    const school = schoolMatch?.[1] ?? '';
    const grade = gradeMatch?.[1] ?? null;

    // Stats: each .stat text is "<n> <label>"
    const statMap: Record<string, number | null> = {};
    card.querySelectorAll('.stat').forEach((s) => {
      const t = s.text.trim();
      const m = t.match(/^(\d[\d,]*)\s+(\w+)/);
      if (m) statMap[m[2].toLowerCase()] = Number(m[1].replace(/,/g, ''));
    });

    return {
      artist_id,
      name,
      school,
      grade,
      artwork_count: statMap['artworks'] ?? null,
      fan_count: statMap['fans'] ?? null,
      comment_count: statMap['comments'] ?? null,
      feedback_count: statMap['feedback'] ?? null,
      award_count: statMap['awards'] ?? null,
      portfolio_path: href ?? `/artists/portfolio.asp?id=${artist_id}`,
    };
  }).filter((s): s is Student => s !== null);
}

export interface Notifications {
  count: number;
  items: Array<{ title: string; body: string; href: string }>;
}

export function parseNotifications(html: string): Notifications {
  const root = parse(html);

  // Count: from .textSubhead whose text contains "Notifications"
  const subhead = root.querySelectorAll('.textSubhead').find((el) =>
    el.text.includes('Notifications'),
  ) ?? null;
  const count = firstIntIn(text(subhead).match(/\((\d+)\)/)?.[1]) ?? 0;

  // Items: each div.notice
  const items = root.querySelectorAll('div.notice').map((notice) => {
    const anchor = notice.querySelector('a.lightlink');
    const title = text(anchor);
    const href = anchor?.getAttribute('href') ?? '';
    // Body: full notice text minus the title text, trimmed
    const fullText = notice.text.replace(/\s+/g, ' ').trim();
    const body = fullText.replace(title, '').replace(/\s+/g, ' ').trim();
    return { title, body, href };
  });

  return { count, items };
}

export interface PortfolioTile {
  artwork_id: string;
  is_private: boolean;
  thumbnail: string;
}

export function parsePortfolio(html: string): PortfolioTile[] {
  const root = parse(html);
  return root.querySelectorAll('.grid-item').map((item): PortfolioTile | null => {
    const link = item.querySelector('a[href*="art.asp"]');
    const artwork_id = attrId(link?.getAttribute('href'), 'id');
    if (!artwork_id) return null;
    // Thumbnail is derived from artwork_id — tile uses CSS background, no usable img src
    const thumbnail = `https://images.artsonia.com/art/small/${artwork_id}.jpg`;
    // Private: tile contains a .private-art element
    const is_private = item.querySelector('.private-art') !== null;
    return { artwork_id, is_private, thumbnail };
  }).filter((a): a is PortfolioTile => a !== null);
}

export interface ArtworkDetail {
  title: string;
  artist_screen_name: string;
  views: number | null;
  project: string;
  comment_entry: { artist_id: string; artwork_id: string } | null;
  // NOTE: comment-item markup is UNVERIFIED — 0-comment accounts show no comment elements.
  // Confirm against an artwork that has comments before trusting this.
  // See docs/ARTSONIA-API.md.
  comments: Array<{ author: string; text: string }>;
}

export function parseArtwork(html: string): ArtworkDetail {
  const root = parse(html);

  // title + screen-name from <title>: `... "<Title>" by <ScreenName>`
  const rawTitle = text(root.querySelector('title'));
  const title = rawTitle.match(/"([^"]+)"/)?.[1] ?? '';
  const artist_screen_name = rawTitle.match(/by\s+(\S+)\s*$/)?.[1] ?? '';

  // views from .textNormal whose text matches "<n> artwork views"
  let views: number | null = null;
  for (const el of root.querySelectorAll('.textNormal')) {
    const m = el.text.match(/(\d+)\s+artwork views?/);
    if (m) { views = Number(m[1]); break; }
  }

  // project from body text: `from school project "<Project>"`
  const bodyText = root.querySelector('body')?.text ?? '';
  const project = bodyText.match(/from school project "([^"]+)"/)?.[1] ?? '';

  // comment entry link
  const link = root.querySelector('a[href*="comments/enter.asp"]');
  const href = link?.getAttribute('href');
  const aId = attrId(href, 'artist');
  const wId = attrId(href, 'art');
  const comment_entry = aId && wId ? { artist_id: aId, artwork_id: wId } : null;

  // NOTE: comment-item markup is UNVERIFIED — 0-comment accounts show no comment elements.
  // Confirm against an artwork that has comments before trusting this.
  // See docs/ARTSONIA-API.md.
  // Using a reasonable selector that degrades to [] on 0-comment pages without throwing.
  const comments = root.querySelectorAll('.comment').map((c) => ({
    author: text(c.querySelector('.comment-author')),
    text: text(c.querySelector('.comment-text')),
  }));

  return { title, artist_screen_name, views, project, comment_entry, comments };
}

export interface Fan { name: string; relationship: string; }

export function parseFans(html: string): Fan[] {
  const root = parse(html);
  return root.querySelectorAll('.fan-card').map((card): Fan | null => {
    // Name: first a.hiddenlink text
    const nameEl = card.querySelector('a.hiddenlink');
    const name = text(nameEl);
    if (!name) return null;

    // Relationship: find a descendant <div> whose own direct text-node content
    // is a non-empty string that is not the fan's name and looks like a relationship word.
    // The real structure: <div>Father<b>Registered</b></div> — own-text is "Father".
    let relationship = '';
    for (const div of card.querySelectorAll('div')) {
      const own = ownText(div);
      // Must be non-empty, not blank, not equal to the name
      if (own && own !== name) {
        relationship = own;
        break;
      }
    }

    return { name, relationship };
  }).filter((f): f is Fan => f !== null);
}
