import { describe, it, expect } from 'vitest';
import { CookieJar } from '../src/cookies.js';

describe('CookieJar', () => {
  it('parses name=value from Set-Cookie lines, ignoring attributes', () => {
    const jar = new CookieJar();
    jar.setFromHeaders([
      'ASPSESSIONID=abc123; path=/; HttpOnly',
      'AID=42; expires=Wed, 09 Jun 2027 10:18:14 GMT; path=/',
    ]);
    expect(jar.header()).toBe('ASPSESSIONID=abc123; AID=42');
    expect(jar.size).toBe(2);
  });

  it('later Set-Cookie for the same name overwrites the earlier value', () => {
    const jar = new CookieJar();
    jar.setFromHeaders(['SID=old; path=/']);
    jar.setFromHeaders(['SID=new; path=/']);
    expect(jar.header()).toBe('SID=new');
  });

  it('ignores blank / malformed lines and returns empty header when empty', () => {
    const jar = new CookieJar();
    jar.setFromHeaders(['', '   ', 'novalue']);
    expect(jar.header()).toBe('');
    expect(jar.size).toBe(0);
  });

  it('drops a cookie whose value is "deleted" with an expiry in the past', () => {
    const jar = new CookieJar();
    jar.setFromHeaders(['SID=real; path=/']);
    jar.setFromHeaders(['SID=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/']);
    expect(jar.size).toBe(0);
  });
});
