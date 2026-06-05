// Placeholder — fully implemented in Task 4. Only loaded when ARTSONIA_TRANSPORT=fetchproxy.
import type { ArtsoniaRequest, ArtsoniaResponse, ArtsoniaTransport } from './transport.js';

export class FetchproxyArtsoniaTransport implements ArtsoniaTransport {
  async request(_req: ArtsoniaRequest): Promise<ArtsoniaResponse> {
    throw new Error('fetchproxy transport not yet implemented');
  }
}
