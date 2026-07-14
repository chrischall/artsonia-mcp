import type { ConnectorAuth } from '@chrischall/mcp-connector';
import { AuthManager } from './auth.js';
import { FetchArtsoniaTransport } from './transport-fetch.js';

/**
 * OAuth props stored per user by the Cloudflare connector's OAuth provider.
 *
 * Like the OFW connector (and unlike Zola, which stores one long-lived token),
 * we store the Artsonia username AND password. Artsonia authenticates with a
 * classic server-rendered form login that mints a short-lived HttpOnly SESSION
 * cookie and hands back NO long-lived refresh token — so the per-user client
 * must be able to re-run the form login on its own whenever the session cookie
 * expires. These props are encrypted at rest in `OAUTH_KV` by the OAuth
 * provider.
 *
 * The index signature satisfies `createConnector`'s
 * `Props extends Record<string, unknown>` constraint.
 */
export interface ArtsoniaProps {
  username: string;
  password: string;
  [key: string]: unknown;
}

/**
 * `ConnectorAuth` for the Artsonia remote connector: the login page collects the
 * user's own Artsonia parent/fan email + password, verifies them by running the
 * same `POST /members/login.asp` form login the stdio server uses (via
 * `AuthManager.ensureLogin`, a serverless-safe direct HTTP login — no browser),
 * and stores `{ username, password }` as the OAuth props that `worker.ts`'s
 * `buildClient` turns into a per-user, direct-mode `ArtsoniaClient` capable of
 * re-authenticating when its session cookie expires.
 */
export const artsoniaAuth: ConnectorAuth<ArtsoniaProps> = {
  service: 'Artsonia',
  accent: '#E8452C',
  privacyNote:
    'Your Artsonia email and password are stored encrypted and used only to sign in to Artsonia on your behalf. ' +
    'Artsonia issues no long-lived token, so your password is kept to re-run the sign-in when the session cookie expires.',
  fields: [
    { name: 'username', label: 'Artsonia email or username' },
    { name: 'password', label: 'Artsonia password', type: 'password' },
  ],
  async login(fields) {
    // Verify the credentials up front: run the real form login. A bad
    // email/password (or a magic-link-only account) throws here, which the
    // connector surfaces back on the login page. The minted session is
    // discarded — the per-user client logs in again from the stored creds.
    const transport = new FetchArtsoniaTransport();
    const auth = new AuthManager(transport, { username: fields.username, password: fields.password });
    await auth.ensureLogin();
    return { username: fields.username, password: fields.password };
  },
};
