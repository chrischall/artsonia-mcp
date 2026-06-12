import { describe, it, expect } from 'vitest';
import * as piexif from 'piexif-ts';
import { embedJpegMetadata } from '../../src/tools/embed.js';
import { tinyJpeg, parseIptc } from '../jpeg-fixture.js';

const FIELDS = {
  title: 'My silhouette',
  project: 'Silhouette',
  grade: '6',
  date: new Date('2022-03-18T15:51:37Z'),
};

describe('embedJpegMetadata', () => {
  it('writes EXIF ImageDescription + DateTimeOriginal that parse back from the bytes', () => {
    const out = embedJpegMetadata(tinyJpeg(), FIELDS);
    const exif = piexif.load(out.toString('latin1'));
    expect(exif['0th']![piexif.TagValues.ImageIFD.ImageDescription]).toBe('My silhouette');
    expect(exif['Exif']![piexif.TagValues.ExifIFD.DateTimeOriginal]).toBe('2022:03:18 15:51:37');
    expect(exif['Exif']![piexif.TagValues.ExifIFD.DateTimeDigitized]).toBe('2022:03:18 15:51:37');
  });

  it('writes IPTC title, keywords (project + grade), caption, and date', () => {
    const out = embedJpegMetadata(tinyJpeg(), FIELDS);
    const sets = parseIptc(out);
    expect(sets.length).toBeGreaterThan(0);
    const str = (r: number, d: number) => sets.filter((s) => s.record === r && s.dataset === d).map((s) => s.data.toString('utf8'));
    expect(str(2, 5)).toEqual(['My silhouette']); // ObjectName
    expect(str(2, 25)).toEqual(expect.arrayContaining(['Silhouette', 'Grade 6'])); // Keywords
    expect(str(2, 55)).toEqual(['20220318']); // DateCreated
    expect(str(2, 120)[0]).toContain('Silhouette'); // Caption/Abstract
  });

  it('output is still a well-formed JPEG (SOI intact, EOI preserved)', () => {
    const out = embedJpegMetadata(tinyJpeg(), FIELDS);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
    expect(out.length).toBeGreaterThan(tinyJpeg().length);
  });

  it('throws on non-JPEG input (caller treats embedding as best-effort)', () => {
    expect(() => embedJpegMetadata(Buffer.alloc(100), FIELDS)).toThrow();
  });

  it('empty fields collapse cleanly — date-only embed still parses', () => {
    const out = embedJpegMetadata(tinyJpeg(), { date: new Date('2021-09-10T00:00:00Z') });
    const exif = piexif.load(out.toString('latin1'));
    expect(exif['Exif']![piexif.TagValues.ExifIFD.DateTimeOriginal]).toBe('2021:09:10 00:00:00');
    expect(exif['0th']![piexif.TagValues.ImageIFD.ImageDescription]).toBeUndefined();
    const sets = parseIptc(out);
    expect(sets.filter((s) => s.record === 2 && s.dataset === 5)).toHaveLength(0); // no empty ObjectName
    expect(sets.filter((s) => s.record === 2 && s.dataset === 25)).toHaveLength(0); // no empty keywords
  });

  it('re-embedding replaces rather than duplicates the metadata segments', () => {
    const once = embedJpegMetadata(tinyJpeg(), FIELDS);
    const twice = embedJpegMetadata(once, { ...FIELDS, title: 'Renamed' });
    const exif = piexif.load(twice.toString('latin1'));
    expect(exif['0th']![piexif.TagValues.ImageIFD.ImageDescription]).toBe('Renamed');
    const titles = parseIptc(twice).filter((s) => s.record === 2 && s.dataset === 5);
    expect(titles).toHaveLength(1);
    expect(titles[0].data.toString('utf8')).toBe('Renamed');
  });
});
