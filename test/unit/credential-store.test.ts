import { describe, it, expect, vi } from 'vitest';
import type { ClientConfig } from '../../src/config/schema.js';

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

function makeClient(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    systemId: 'test_client',
    password: '$2b$10$5Ic2KDjl6Si4uqKgulJKr.PsW42bM5jJc9uWK8ptMKuE.CWnVD6RS',
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

describe('CredentialStore', () => {
  it('loads enabled clients', () => {
    const store = new CredentialStore([makeClient({ systemId: 'a' }), makeClient({ systemId: 'b' })]);
    expect(store.findBySystemId('a')).toBeDefined();
    expect(store.findBySystemId('b')).toBeDefined();
  });

  it('skips disabled clients', () => {
    const store = new CredentialStore([makeClient({ systemId: 'a', enabled: false })]);
    expect(store.findBySystemId('a')).toBeUndefined();
  });

  describe('reload()', () => {
    it('adds new clients', () => {
      const store = new CredentialStore([makeClient({ systemId: 'a' })]);
      const diff = store.reload([makeClient({ systemId: 'a' }), makeClient({ systemId: 'b' })]);

      expect(diff.added).toEqual(['b']);
      expect(diff.updated).toEqual([]);
      expect(diff.removed).toEqual([]);
      expect(store.findBySystemId('b')).toBeDefined();
    });

    it('removes clients no longer in config', () => {
      const store = new CredentialStore([makeClient({ systemId: 'a' }), makeClient({ systemId: 'b' })]);
      const diff = store.reload([makeClient({ systemId: 'a' })]);

      expect(diff.removed).toEqual(['b']);
      expect(store.findBySystemId('b')).toBeUndefined();
    });

    it('removes clients that are disabled', () => {
      const store = new CredentialStore([makeClient({ systemId: 'a' }), makeClient({ systemId: 'b' })]);
      const diff = store.reload([makeClient({ systemId: 'a' }), makeClient({ systemId: 'b', enabled: false })]);

      expect(diff.removed).toEqual(['b']);
      expect(store.findBySystemId('b')).toBeUndefined();
    });

    it('detects updated clients', () => {
      const store = new CredentialStore([makeClient({ systemId: 'a', maxTps: 50 })]);
      const diff = store.reload([makeClient({ systemId: 'a', maxTps: 200 })]);

      expect(diff.updated).toEqual(['a']);
      expect(store.findBySystemId('a')!.maxTps).toBe(200);
    });

    it('returns empty diff when nothing changed', () => {
      const client = makeClient({ systemId: 'a' });
      const store = new CredentialStore([client]);
      const diff = store.reload([makeClient({ systemId: 'a' })]);

      expect(diff.added).toEqual([]);
      expect(diff.updated).toEqual([]);
      expect(diff.removed).toEqual([]);
    });

    it('preserves old references after reload', () => {
      const store = new CredentialStore([makeClient({ systemId: 'a', apiKey: 'old-key' })]);
      const oldRef = store.findBySystemId('a');

      store.reload([makeClient({ systemId: 'a', apiKey: 'new-key' })]);

      // Old reference still holds old value
      expect(oldRef!.apiKey).toBe('old-key');
      // New lookup returns new value
      expect(store.findBySystemId('a')!.apiKey).toBe('new-key');
    });
  });
});
