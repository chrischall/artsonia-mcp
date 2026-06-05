import { parse, type HTMLElement } from 'node-html-parser';

const firstIntIn = (s: string | undefined): number | null => {
  const m = (s ?? '').match(/(\d[\d,]*)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};
const text = (el: HTMLElement | null): string => (el ? el.text.replace(/\s+/g, ' ').trim() : '');
const attrId = (href: string | undefined, key: string): string | null => {
  const m = (href ?? '').match(new RegExp(`[?&](?:amp;)?${key}=(\\d+)`));
  return m ? m[1] : null;
};

export interface Student {
  artist_id: string; name: string; school: string; grade: string | null;
  artwork_count: number | null; fan_count: number | null; portfolio_path: string;
}

export function parseStudents(html: string): Student[] {
  const root = parse(html);
  return root.querySelectorAll('.artist-card').map((card): Student | null => {
    const link = card.querySelector('a[href*="portfolio.asp"]');
    const href = link?.getAttribute('href');
    const artist_id = attrId(href, 'id');
    if (!artist_id) return null;
    const school = text(card.querySelector('.artist-school'));
    const grade = school.match(/Grade\s+(\w+)/i)?.[1] ?? null;
    return {
      artist_id,
      name: text(card.querySelector('.artist-name')),
      school,
      grade,
      artwork_count: firstIntIn(text(card.querySelector('.stat-artworks'))),
      fan_count: firstIntIn(text(card.querySelector('.stat-fans'))),
      portfolio_path: href ?? `/artists/portfolio.asp?id=${artist_id}`,
    };
  }).filter((s): s is Student => s !== null);
}

export interface Notifications { count: number; items: Array<{ title: string; body: string; href: string }>; }

export function parseNotifications(html: string): Notifications {
  const root = parse(html);
  const section = root.querySelector('.notifications');
  const count = firstIntIn(text(section?.querySelector('h2') ?? null)) ?? 0;
  const items = (section?.querySelectorAll('a.notice') ?? []).map((a) => ({
    title: text(a.querySelector('.notice-title')),
    body: text(a.querySelector('.notice-body')),
    href: a.getAttribute('href') ?? '',
  }));
  return { count, items };
}

export interface Artwork { artwork_id: string; title: string; is_private: boolean; thumbnail: string | null; }

export function parsePortfolio(html: string): Artwork[] {
  const root = parse(html);
  return root.querySelectorAll('.grid-item').map((item): Artwork | null => {
    const link = item.querySelector('a[href*="art.asp"]');
    const artwork_id = attrId(link?.getAttribute('href'), 'id');
    if (!artwork_id) return null;
    const label = item.querySelector('.textLabel');
    return {
      artwork_id,
      title: text(label),
      is_private: (label?.getAttribute('class') ?? '').includes('private-art'),
      thumbnail: item.querySelector('img')?.getAttribute('src') ?? null,
    };
  }).filter((a): a is Artwork => a !== null);
}

export interface ArtworkDetail {
  title: string; artist_screen_name: string; views: number | null; description: string;
  comment_entry: { artist_id: string; artwork_id: string } | null;
  comments: Array<{ author: string; text: string }>;
}

export function parseArtwork(html: string): ArtworkDetail {
  const root = parse(html);
  const rawTitle = text(root.querySelector('title'));
  const title = rawTitle.match(/"([^"]+)"/)?.[1] ?? '';
  const screen = rawTitle.match(/by\s+([A-Za-z0-9_]+)/)?.[1] ?? '';
  const link = root.querySelector('a[href*="comments/enter.asp"]');
  const href = link?.getAttribute('href');
  const aId = attrId(href, 'artist');
  const wId = attrId(href, 'art');
  return {
    title,
    artist_screen_name: screen,
    views: firstIntIn(text(root.querySelector('.artwork-views'))),
    description: text(root.querySelector('.artwork-description')),
    comment_entry: aId && wId ? { artist_id: aId, artwork_id: wId } : null,
    comments: root.querySelectorAll('.comment').map((c) => ({
      author: text(c.querySelector('.comment-author')),
      text: text(c.querySelector('.comment-text')),
    })),
  };
}

export interface Fan { name: string; relationship: string; }

export function parseFans(html: string): Fan[] {
  const root = parse(html);
  return root.querySelectorAll('.fan-card').map((c) => ({
    name: text(c.querySelector('.fan-name')),
    relationship: text(c.querySelector('.fan-relation')),
  })).filter((f) => f.name);
}
