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

export interface Feedback {
  /** Artwork the feedback is about (from the row's `art.asp?id=` link). */
  artwork_id: string | null;
  /** The teacher feedback text. */
  message: string;
  /** Attribution line, e.g. "Posted 9 months ago by Curt Atkins (teacher) at <School>". */
  posted_by: string;
  /** False while the row shows "has not been marked as read". */
  is_read: boolean;
  thumbnail: string | null;
}

export function parseFeedback(html: string): Feedback[] {
  const root = parse(html);
  return root.querySelectorAll('.comment-row').map((row): Feedback => {
    const link = row.querySelector('.comment-art a[href*="art.asp"]');
    const artwork_id = attrId(link?.getAttribute('href'), 'id');
    const options = text(row.querySelector('.comment-options'));
    return {
      artwork_id,
      message: text(row.querySelector('.comment')),
      posted_by: text(row.querySelector('.commenter')),
      is_read: !/not been marked as read/i.test(options),
      thumbnail: artwork_id ? `https://images.artsonia.com/art/small/${artwork_id}.jpg` : null,
    };
  });
}

export interface Award {
  name: string;
  /** True only when the card says "Earned" (NOT "Not earned"). */
  earned: boolean;
  /** Criteria text, e.g. "Publish three or more artworks this year." (current-year only). */
  description: string;
  /** Progress text, e.g. "2 fans joined" (current-year only). */
  progress: string;
  /** "current" = this school year's badges; "past" = badges earned in prior years. */
  period: 'current' | 'past';
}

export function parseAwards(html: string): Award[] {
  const root = parse(html);
  const awards: Award[] = [];
  // Current-year achievement badges: name / status / criteria / progress.
  // The card is `<img><div>(content)<div>name</div><div>status</div>…</div>`;
  // walk the content wrapper's child divs (the first descendant div is the wrapper).
  for (const card of root.querySelectorAll('.award-card')) {
    const content = card.querySelector('div');
    const lines = content ? content.querySelectorAll('div').map((d) => text(d)).filter(Boolean) : [];
    const name = lines[0] ?? '';
    if (!name) continue;
    awards.push({
      name,
      earned: /^earned$/i.test((lines[1] ?? '').trim()),
      description: lines[2] ?? '',
      progress: lines[3] ?? '',
      period: 'current',
    });
  }
  // Past-year earned badges: just an icon (artist_<name>[_ghosted].gif).
  for (const card of root.querySelectorAll('.award-card-past')) {
    const file = card.querySelector('img')?.getAttribute('src')?.split('/').pop() ?? '';
    const slug = file.replace(/\.gif$/i, '').replace(/_ghosted$/i, '').replace(/^artist_/i, '');
    const name = slug ? slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Award';
    awards.push({ name, earned: true, description: '', progress: '', period: 'past' });
  }
  return awards;
}

export interface Profile {
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  opt_ins: { news: boolean; artist_activity: boolean; promos: boolean };
}

/** Read-only view of the parent profile form (`#TheForm` on /members/profile/). */
export function parseProfile(html: string): Profile {
  const form = parse(html).querySelector('#TheForm');
  const val = (name: string) => form?.querySelector(`input[name="${name}"], select[name="${name}"]`)?.getAttribute('value') ?? '';
  const checked = (name: string) => form?.querySelector(`input[name="${name}"]`)?.hasAttribute('checked') ?? false;
  return {
    first_name: val('FirstName'),
    last_name: val('LastName'),
    email: val('EmailAddress'),
    mobile: val('MobileNumber'),
    opt_ins: { news: checked('OptInNews'), artist_activity: checked('OptInArtistActivity'), promos: checked('OptInPromos') },
  };
}
