/** Shared JPEG test fixture + a tiny IPTC reader used to verify embedded bytes. */

// Minimal valid 1x1 grayscale JPEG (no EXIF/IPTC) — verified to round-trip piexif.
export const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
export const tinyJpeg = (): Buffer => Buffer.from(TINY_JPEG_B64, 'base64');

/** Parse the IPTC IIM datasets out of a JPEG's Photoshop APP13 segment. */
export function parseIptc(buf: Buffer): Array<{ record: number; dataset: number; data: Buffer }> {
  const out: Array<{ record: number; dataset: number; data: Buffer }> = [];
  let off = 2; // past SOI
  while (off + 4 <= buf.length && buf[off] === 0xff && buf[off + 1] !== 0xda) {
    const marker = buf[off + 1];
    const len = buf.readUInt16BE(off + 2);
    if (marker === 0xed) {
      let p = off + 4;
      const segEnd = off + 2 + len;
      if (buf.toString('latin1', p, p + 14) === 'Photoshop 3.0\0') {
        p += 14;
        while (p + 12 <= segEnd && buf.toString('latin1', p, p + 4) === '8BIM') {
          const resId = buf.readUInt16BE(p + 4);
          const nameLen = buf[p + 6];
          let q = p + 7 + nameLen;
          if ((1 + nameLen) % 2 === 1) q += 1; // pascal name padded to even
          const size = buf.readUInt32BE(q);
          q += 4;
          if (resId === 0x0404) {
            let d = q;
            const dataEnd = q + size;
            while (d + 5 <= dataEnd && buf[d] === 0x1c) {
              const dlen = buf.readUInt16BE(d + 3);
              out.push({ record: buf[d + 1], dataset: buf[d + 2], data: buf.subarray(d + 5, d + 5 + dlen) });
              d += 5 + dlen;
            }
          }
          p = q + size + (size % 2); // resource data padded to even
        }
      }
    }
    off += 2 + len;
  }
  return out;
}
