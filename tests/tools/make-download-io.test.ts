import { describe, it, expect, afterEach } from 'vitest';
import { makeDownloadIO } from '../../src/tools/make-download-io.js';

// The env-selected download-IO switch. Local stdio installs must keep the
// disk-backed IO (any other default would silently stop writing files); a hosted
// deployment opts in to the inline IO, whose base64 image blocks are the only way
// a remote user can ever receive the bytes.
describe('makeDownloadIO', () => {
  const saved = process.env.ARTSONIA_INLINE_DOWNLOADS;
  afterEach(() => {
    if (saved === undefined) delete process.env.ARTSONIA_INLINE_DOWNLOADS;
    else process.env.ARTSONIA_INLINE_DOWNLOADS = saved;
  });

  it('defaults to the disk-backed NodeDownloadIO', () => {
    delete process.env.ARTSONIA_INLINE_DOWNLOADS;
    const io = makeDownloadIO();
    expect(io.constructor.name).toBe('NodeDownloadIO');
    expect(io.persistsFiles).toBe(true);
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'on'])(
    'selects the InlineDownloadIO when ARTSONIA_INLINE_DOWNLOADS=%s',
    (value) => {
      process.env.ARTSONIA_INLINE_DOWNLOADS = value;
      const io = makeDownloadIO();
      expect(io.constructor.name).toBe('InlineDownloadIO');
      expect(io.persistsFiles).toBe(false);
    },
  );

  it.each(['0', 'false', 'no', 'off', ''])(
    'keeps the disk-backed IO when ARTSONIA_INLINE_DOWNLOADS=%s',
    (value) => {
      process.env.ARTSONIA_INLINE_DOWNLOADS = value;
      expect(makeDownloadIO().constructor.name).toBe('NodeDownloadIO');
    },
  );
});
