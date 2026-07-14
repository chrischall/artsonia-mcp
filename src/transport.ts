export interface ArtsoniaRequest {
  method: 'GET' | 'POST';
  /** Path-and-query relative to https://www.artsonia.com, or an absolute URL. */
  path: string;
  headers?: Record<string, string>;
  /** Serialized request body (form-urlencoded). Omitted for GET. */
  body?: string;
  /** 'follow' (default) for reads; 'manual' for the login POST so the 302's Set-Cookie is readable. */
  redirect?: 'follow' | 'manual';
}

export interface ArtsoniaResponse {
  status: number;
  body: string;
  /** Final URL after redirects (used to detect login redirects). */
  url: string;
  /** Set-Cookie header lines from this response. */
  setCookie: string[];
  /** Location header (present on a manual 3xx). */
  location?: string;
}

export interface ArtsoniaTransport {
  request(req: ArtsoniaRequest): Promise<ArtsoniaResponse>;
  /**
   * True when the transport rides the user's already-signed-in browser tab
   * (fetchproxy), so the browser carries the session and the server-side
   * username/password login MUST be skipped — there is no server jar to fill,
   * and `doLogin`'s 302+Location success marker never appears (the browser
   * follows the redirect itself). Absent/false ⇒ the server owns the session.
   */
  readonly usesBrowserSession?: boolean;
}

export const ARTSONIA_ORIGIN = 'https://www.artsonia.com';

// NOTE: `makeTransport()` (the env-driven direct-vs-fetchproxy selector) lives in
// `./make-transport.ts`, NOT here. This module is a LEAF — pure types + the
// origin constant, with no import of `@fetchproxy/server`. The hosted Cloudflare
// Worker's module graph reaches this file (via transport-fetch → client-core),
// so keeping the fetchproxy dynamic import out of it is what stops the bridge
// from being pulled into the Worker bundle. Only the stdio singleton (client.ts)
// imports make-transport.ts, and the Worker never imports client.ts.
