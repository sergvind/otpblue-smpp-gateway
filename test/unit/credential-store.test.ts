import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import type { ClientConfig, AuthApiConfig } from '../../src/config/schema.js';

// Suppress logger output in tests
vi.mock('../../src/monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
}));

import { CredentialStore } from '../../src/auth/credential-store.js';

const API_BASE = 'https://auth.example.com';
const API_KEY = 'test-auth-key';
const AUTH_PATH = '/api/v1/smpp/auth/';

const authApiConfig: AuthApiConfig = {
  url: API_BASE,
  apiKey: API_KEY,
  cacheTtlMs: 60_000,
};

function makeClientResponse(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    systemId: 'test_client',
    password: 'test_pass',
    apiKey: 'test-api-key',
    defaultSender: 'OTP',
    defaultLanguage: 'en',
    maxTps: 50,
    codePatterns: [],
    allowedIps: [],
    enabled: true,
    failureMode: 'immediate',
    ...overrides,
  };
}

describe('CredentialStore (API-backed)', () => {
  let store: CredentialStore;

  beforeEach(() => {
    nock.cleanAll();
    store = new CredentialStore(authApiConfig);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('verifyPassword()', () => {
    it('fetches from API and verifies correct plaintext password', async () => {
      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .reply(200, makeClientResponse());

      const result = await store.verifyPassword('test_client', 'test_pass');
      expect(result).not.toBeNull();
      expect(result!.systemId).toBe('test_client');
      expect(result!.apiKey).toBe('test-api-key');
    });

    it('returns null for wrong password', async () => {
      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .reply(200, makeClientResponse());

      const result = await store.verifyPassword('test_client', 'wrong_pass');
      expect(result).toBeNull();
    });

    it('returns null for unknown systemId (API 404)', async () => {
      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'unknown' })
        .reply(404, { error: 'Not found' });

      const result = await store.verifyPassword('unknown', 'pass');
      expect(result).toBeNull();
    });

    it('returns null for disabled client', async () => {
      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'disabled' })
        .reply(200, makeClientResponse({ systemId: 'disabled', enabled: false }));

      const result = await store.verifyPassword('disabled', 'test_pass');
      expect(result).toBeNull();
    });

    it('sends Authorization header to API', async () => {
      nock(API_BASE, { reqheaders: { authorization: API_KEY } })
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .reply(200, makeClientResponse());

      const result = await store.verifyPassword('test_client', 'test_pass');
      expect(result).not.toBeNull();
    });
  });

  describe('caching', () => {
    it('uses cached result on second call (no second API request)', async () => {
      const scope = nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .once()
        .reply(200, makeClientResponse());

      await store.verifyPassword('test_client', 'test_pass');
      await store.verifyPassword('test_client', 'test_pass');

      scope.done();
    });

    it('re-fetches after TTL expires', async () => {
      const shortTtlStore = new CredentialStore({
        ...authApiConfig,
        cacheTtlMs: 50,
      });

      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .reply(200, makeClientResponse({ apiKey: 'key-v1' }));

      const first = await shortTtlStore.verifyPassword('test_client', 'test_pass');
      expect(first!.apiKey).toBe('key-v1');

      await new Promise(resolve => setTimeout(resolve, 60));

      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .reply(200, makeClientResponse({ apiKey: 'key-v2' }));

      const second = await shortTtlStore.verifyPassword('test_client', 'test_pass');
      expect(second!.apiKey).toBe('key-v2');
    });

    it('falls back to stale cache when API is down', async () => {
      const shortTtlStore = new CredentialStore({
        ...authApiConfig,
        cacheTtlMs: 50,
      });

      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .reply(200, makeClientResponse());

      const first = await shortTtlStore.verifyPassword('test_client', 'test_pass');
      expect(first).not.toBeNull();

      await new Promise(resolve => setTimeout(resolve, 60));

      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .replyWithError('connect ECONNREFUSED');

      const second = await shortTtlStore.verifyPassword('test_client', 'test_pass');
      expect(second).not.toBeNull();
      expect(second!.systemId).toBe('test_client');
    });

    it('returns null when API is down and no stale cache', async () => {
      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .replyWithError('connect ECONNREFUSED');

      const result = await store.verifyPassword('test_client', 'test_pass');
      expect(result).toBeNull();
    });

    it('evict() forces re-fetch on next call', async () => {
      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .reply(200, makeClientResponse({ apiKey: 'old-key' }));

      await store.verifyPassword('test_client', 'test_pass');

      store.evict('test_client');

      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .reply(200, makeClientResponse({ apiKey: 'new-key' }));

      const result = await store.verifyPassword('test_client', 'test_pass');
      expect(result!.apiKey).toBe('new-key');
    });
  });

  describe('API error handling', () => {
    it('handles invalid API response (Zod validation failure)', async () => {
      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .reply(200, { systemId: '', password: '' });

      const result = await store.verifyPassword('test_client', 'test_pass');
      expect(result).toBeNull();
    });

    it('handles API 500 error', async () => {
      nock(API_BASE)
        .get(AUTH_PATH)
        .query({ system_id: 'test_client' })
        .reply(500, 'Internal Server Error');

      const result = await store.verifyPassword('test_client', 'test_pass');
      expect(result).toBeNull();
    });
  });

  describe('isIpAllowed()', () => {
    it('allows any IP when allowedIps is empty', () => {
      const client = makeClientResponse({ allowedIps: [] });
      expect(store.isIpAllowed(client, '10.0.0.1')).toBe(true);
    });

    it('allows listed IP', () => {
      const client = makeClientResponse({ allowedIps: ['10.0.0.1', '10.0.0.2'] });
      expect(store.isIpAllowed(client, '10.0.0.1')).toBe(true);
    });

    it('rejects unlisted IP', () => {
      const client = makeClientResponse({ allowedIps: ['10.0.0.1'] });
      expect(store.isIpAllowed(client, '10.0.0.99')).toBe(false);
    });

    it('normalizes IPv6-mapped IPv4 addresses', () => {
      const client = makeClientResponse({ allowedIps: ['10.0.0.1'] });
      expect(store.isIpAllowed(client, '::ffff:10.0.0.1')).toBe(true);
    });
  });
});
