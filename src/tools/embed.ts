/**
 * EXIF + IPTC embedding for downloaded artwork JPEGs (issue #13).
 *
 * Lazily imported by download.ts only when `embed_metadata: true`, so the
 * default download path never evaluates piexif-ts. piexif-ts is a pure-JS
 * (binary-string) EXIF writer — no native addons — so it inlines cleanly into
 * the esbuild bundle / .mcpb. It covers EXIF only; the IPTC APP13 segment
 * (whose IIM dataset format is a trivial length-prefixed byte layout) is
 * written by hand below so Spotlight/Apple Photos pick up title + keywords.
 */
import * as piexif from 'piexif-ts';

export interface EmbedFields {
  title?: string;
  project?: string;
  /** Normalized grade, e.g. "6" (rendered as keyword "Grade 6"). */
  grade?: string | null;
  /** The image's source date (its Last-Modified — same source as date_source). */
  date?: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** EXIF datetime "YYYY:MM:DD HH:MM:SS" (UTC of the source date). */
function exifDateTime(d: Date): string {
  return `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Truncate a UTF-8 string to a byte budget without splitting a code point. */
function utf8Bytes(s: string, max: number): Buffer {
  let buf = Buffer.from(s, 'utf8');
  if (buf.length <= max) return buf;
  buf = buf.subarray(0, max);
  let end = buf.length;
  while (end > 0 && (buf[end - 1] & 0xc0) === 0x80) end--; // back out of a partial sequence
  if (end > 0 && (buf[end - 1] & 0x80) !== 0 && (buf[end - 1] & 0xc0) !== 0x80) end--; // lead byte with no continuation
  return buf.subarray(0, end);
}

function iptcDataset(record: number, dataset: number, data: Buffer): Buffer {
  const head = Buffer.from([0x1c, record, dataset, data.length >> 8, data.length & 0xff]);
  return Buffer.concat([head, data]);
}

/** Build a Photoshop APP13 segment carrying the IPTC IIM datasets. */
function buildApp13(fields: EmbedFields): Buffer | null {
  const sets: Buffer[] = [
    iptcDataset(1, 90, Buffer.from([0x1b, 0x25, 0x47])), // 1:90 coded character set = UTF-8
    iptcDataset(2, 0, Buffer.from([0x00, 0x04])), // 2:00 record version
  ];
  const title = fields.title?.trim() ?? '';
  const project = fields.project?.trim() ?? '';
  const gradeKw = fields.grade ? `Grade ${fields.grade}` : '';
  if (title) sets.push(iptcDataset(2, 5, utf8Bytes(title, 64))); // ObjectName
  for (const kw of [project, gradeKw]) if (kw) sets.push(iptcDataset(2, 25, utf8Bytes(kw, 64))); // Keywords
  if (fields.date) {
    const d = fields.date;
    sets.push(iptcDataset(2, 55, Buffer.from(`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`))); // DateCreated
  }
  const caption = [title, [project, gradeKw].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
  if (caption) sets.push(iptcDataset(2, 120, utf8Bytes(caption, 2000))); // Caption/Abstract
  if (sets.length <= 2) return null; // nothing beyond the boilerplate → skip the segment

  const data = Buffer.concat(sets);
  const resource = Buffer.concat([
    Buffer.from('8BIM', 'latin1'),
    Buffer.from([0x04, 0x04]), // resource id: IPTC-NAA record
    Buffer.from([0x00, 0x00]), // empty pascal name, padded to even
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(data.length); return b; })(),
    data,
    ...(data.length % 2 ? [Buffer.from([0x00])] : []), // resource data padded to even
  ]);
  const body = Buffer.concat([Buffer.from('Photoshop 3.0\0', 'latin1'), resource]);
  const seg = Buffer.alloc(4);
  seg.writeUInt16BE(0xffed);
  seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([seg, body]);
}

/**
 * Insert (or replace) the APP13 segment: existing APP13s are dropped and the
 * new one lands after the leading APP0/APP1 run, so re-embedding replaces
 * rather than duplicates. Throws on non-JPEG input.
 */
function withApp13(img: Buffer, app13: Buffer): Buffer {
  if (img[0] !== 0xff || img[1] !== 0xd8) throw new Error('not a JPEG (missing SOI)');
  const keep: Buffer[] = [];
  let insertIdx = 0; // index into `keep` after which the APP13 goes
  let off = 2;
  while (off + 4 <= img.length && img[off] === 0xff && img[off + 1] !== 0xda) {
    const marker = img[off + 1];
    const end = off + 2 + img.readUInt16BE(off + 2);
    if (marker !== 0xed) {
      keep.push(img.subarray(off, end));
      if (marker === 0xe0 || marker === 0xe1) insertIdx = keep.length;
    }
    off = end;
  }
  return Buffer.concat([
    img.subarray(0, 2),
    ...keep.slice(0, insertIdx),
    app13,
    ...keep.slice(insertIdx),
    img.subarray(off), // SOS + entropy-coded data + EOI
  ]);
}

/**
 * Embed title/project/grade/date into a JPEG's EXIF (ImageDescription,
 * DateTimeOriginal/Digitized) and IPTC (ObjectName, Keywords, DateCreated,
 * Caption). Returns a new buffer; throws on non-JPEG input — the caller
 * treats embedding as best-effort and falls back to the original bytes.
 */
export function embedJpegMetadata(image: Buffer, fields: EmbedFields): Buffer {
  const zeroth: piexif.IExifElement = {};
  const exifIfd: piexif.IExifElement = {};
  const title = fields.title?.trim();
  if (title) zeroth[piexif.TagValues.ImageIFD.ImageDescription] = title;
  if (fields.date) {
    const dt = exifDateTime(fields.date);
    zeroth[piexif.TagValues.ImageIFD.DateTime] = dt;
    exifIfd[piexif.TagValues.ExifIFD.DateTimeOriginal] = dt;
    exifIfd[piexif.TagValues.ExifIFD.DateTimeDigitized] = dt;
  }
  const exifBinary = piexif.dump({ '0th': zeroth, Exif: exifIfd });
  // piexif.insert replaces any existing APP1 EXIF segment.
  let out: Buffer = Buffer.from(piexif.insert(exifBinary, image.toString('latin1')), 'latin1');
  const app13 = buildApp13(fields);
  if (app13) out = withApp13(out, app13);
  return out;
}
