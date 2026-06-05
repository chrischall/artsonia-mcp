// Minimal cookie jar for Artsonia's session cookies. We only need name=value
// pairs for the Cookie request header — attributes (path/expires/HttpOnly) are
// parsed only to detect deletion (empty value + past expiry).
export class CookieJar {
  private readonly jar = new Map<string, string>();

  setFromHeaders(setCookie: string[]): void {
    for (const line of setCookie) {
      const trimmed = (line ?? '').trim();
      if (!trimmed) continue;
      const [pair, ...attrs] = trimmed.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;
      const isDeletion = value === '' && attrs.some((a) => /expires=/i.test(a) && /1970/.test(a));
      if (isDeletion) { this.jar.delete(name); continue; }
      this.jar.set(name, value);
    }
  }

  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get size(): number {
    return this.jar.size;
  }
}
