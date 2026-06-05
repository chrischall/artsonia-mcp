import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStudents, parseNotifications, parsePortfolio, parseArtwork, parseFans, parseFeedback, parseAwards, parseProfile } from '../src/parse.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fx = (name: string) => readFileSync(join(FIX, name), 'utf8');

describe('parseStudents', () => {
  it('extracts artistId, name, school, grade and counts from .artist-card', () => {
    const students = parseStudents(fx('dashboard.html'));
    expect(students).toHaveLength(2);
    expect(students[0]).toMatchObject({
      artist_id: '16011097',
      name: 'Finn Hall',
      grade: '1',
      artwork_count: 46,
      fan_count: 2,
      comment_count: 0,
      feedback_count: 0,
      award_count: 2,
    });
    expect(students[1]).toMatchObject({ artist_id: '13447141', name: 'Lucas Hall', grade: '6' });
    expect(students[0].school).toContain('Metrolina');
  });
});

describe('parseNotifications', () => {
  it('extracts the count and notice items', () => {
    const n = parseNotifications(fx('dashboard.html'));
    expect(n.count).toBe(2);
    expect(n.items).toHaveLength(2);
    expect(n.items[0]).toMatchObject({
      title: 'View teacher feedback for Lucas',
      href: '/members/comments/?artist=13447141',
    });
    expect(n.items[0].body).toContain('A new comment is waiting.');
  });
});

describe('parsePortfolio', () => {
  it('extracts artworkId, private flag, thumbnail from .grid-item (no title field)', () => {
    const art = parsePortfolio(fx('portfolio.html'));
    expect(art).toHaveLength(2);
    expect(art[0]).toMatchObject({
      artwork_id: '150567537',
      is_private: false,
      thumbnail: 'https://images.artsonia.com/art/small/150567537.jpg',
    });
    expect(art[1].is_private).toBe(true);
  });
});

describe('parseArtwork', () => {
  it('extracts title, artist screen-name, views, project, comment link and comments', () => {
    const a = parseArtwork(fx('artwork.html'));
    expect(a.title).toBe('My silhouette still life');
    expect(a.artist_screen_name).toBe('Lucas26251');
    expect(a.views).toBe(4);
    expect(a.project).toBe('6th Grade Silhouette Still Life');
    expect(a.comment_entry).toMatchObject({ artist_id: '13447141', artwork_id: '150567537' });
    // comments: 0-comment fixture — expect empty array (markup is UNVERIFIED for non-zero)
    expect(Array.isArray(a.comments)).toBe(true);
    expect(a.comments).toHaveLength(0);
  });
});

describe('parseFans', () => {
  it('extracts fan name and relationship from .fan-card', () => {
    const fans = parseFans(fx('fans.html'));
    expect(fans).toHaveLength(2);
    expect(fans[0]).toMatchObject({ name: 'Chris Hall', relationship: 'Father' });
    expect(fans[1]).toMatchObject({ name: 'Grandma Jo', relationship: 'Grandparent' });
  });
});

describe('parseFeedback', () => {
  it('extracts message, attribution, artwork, and read state from .comment-row', () => {
    const fb = parseFeedback(fx('feedback.html'));
    expect(fb).toHaveLength(2);
    expect(fb[0]).toMatchObject({
      artwork_id: '150360715',
      message: 'Looks ready to start next class.',
      is_read: false,
      thumbnail: 'https://images.artsonia.com/art/small/150360715.jpg',
    });
    expect(fb[0].posted_by).toContain('Curt Atkins');
    expect(fb[1]).toMatchObject({ artwork_id: '148945137', is_read: true });
  });
});

describe('parseAwards', () => {
  it('parses current-year badges (earned vs not) and past-year badges', () => {
    const awards = parseAwards(fx('awards.html'));
    const current = awards.filter((a) => a.period === 'current');
    const past = awards.filter((a) => a.period === 'past');
    expect(current).toHaveLength(2);
    expect(current[0]).toMatchObject({ name: 'Portfolio', earned: true, description: 'Publish three or more artworks this year.', progress: '12 artworks this year' });
    expect(current[1]).toMatchObject({ name: 'Popular Artist', earned: false }); // "Not earned" → false
    expect(past).toHaveLength(2);
    expect(past[0]).toMatchObject({ name: 'Portfolio', earned: true, period: 'past' });
    expect(awards.filter((a) => a.earned)).toHaveLength(3); // 1 current + 2 past
  });
});

describe('parseProfile', () => {
  it('reads name/email/mobile and opt-in states from the profile form', () => {
    const p = parseProfile(fx('profile.html'));
    expect(p).toMatchObject({
      first_name: 'Chris',
      last_name: 'Hall',
      email: 'chris@example.com',
      mobile: '5550001234',
      opt_ins: { news: false, artist_activity: true, promos: false },
    });
  });
});
