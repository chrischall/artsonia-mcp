import { afterEach, vi } from 'vitest';

// Vitest registers the return value of a beforeEach hook as a cleanup
// callback if the return value is a function. vi.spyOn's mockClear() returns
// the spy itself (for chaining), so `beforeEach(() => spy.mockClear())` causes
// vitest to call `spy()` as a cleanup after the test. If the test set
// mockRejectedValue, this cleanup call returns a rejected Promise, which
// vitest treats as a test failure even though the test body and assertions
// passed successfully.
//
// The fix: after each test, restore client.fetchHtml to a safe resolved value.
// This runs before vitest's cleanup callbacks (beforeEachCleanups), so the
// cleanup call to spy() returns Promise.resolve('') instead of a rejection.
//
// We use a dynamic import to avoid loading client.ts (which calls
// loadDotenvSafely at module level) in workers for test files that don't use
// the client singleton — in particular auth.test.ts, which tests that
// AuthManager rejects when ARTSONIA_USERNAME is not set.
afterEach(async () => {
  const { client } = await import('../src/client.js');
  if (vi.isMockFunction(client.fetchHtml)) {
    vi.spyOn(client, 'fetchHtml').mockResolvedValue('' as never);
  }
});
