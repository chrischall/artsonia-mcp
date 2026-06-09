import { readEnvVar } from '@chrischall/mcp-utils';

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

export async function makeTransport(): Promise<ArtsoniaTransport> {
  const mode = readEnvVar('ARTSONIA_TRANSPORT') ?? 'fetch';
  if (mode === 'fetchproxy') {
    const { FetchproxyArtsoniaTransport } = await import('./transport-fetchproxy.js');
    return new FetchproxyArtsoniaTransport();
  }
  const { FetchArtsoniaTransport } = await import('./transport-fetch.js');
  return new FetchArtsoniaTransport();
}
