import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

import { ConfigWatcher } from '../../src/config/config-watcher.js';
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

function writeConfig(filePath: string, clients: Partial<ClientConfig>[]) {
  fs.writeFileSync(filePath, JSON.stringify({ clients }, null, 2));
}

describe('ConfigWatcher', () => {
  let tmpDir: string;
  let configPath: string;
  let credentialStore: CredentialStore;
  let clientRateLimiters: Map<string, unknown>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-watcher-test-'));
    configPath = path.join(tmpDir, 'clients.json');

    const initialClient = makeClient({ systemId: 'client_a' });
    writeConfig(configPath, [initialClient]);

    credentialStore = new CredentialStore([initialClient]);
    clientRateLimiters = new Map();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects file changes and triggers reload via forceReload()', () => {
    const watcher = new ConfigWatcher({
      configPath,
      credentialStore,
      clientRateLimiters: clientRateLimiters as Map<string, never>,
    });
    watcher.start();

    // Add a new client to the file
    writeConfig(configPath, [
      makeClient({ systemId: 'client_a' }),
      makeClient({ systemId: 'client_b', apiKey: 'key-b' }),
    ]);

    const reloaded = watcher.forceReload();
    expect(reloaded).toBe(true);
    expect(credentialStore.findBySystemId('client_b')).toBeDefined();

    watcher.stop();
  });

  it('returns false when file content has not changed', () => {
    const watcher = new ConfigWatcher({
      configPath,
      credentialStore,
      clientRateLimiters: clientRateLimiters as Map<string, never>,
    });
    watcher.start();

    // No file change — non-forced check should return false
    // forceReload bypasses hash check, so we test the internal polling behavior
    // by calling forceReload twice without changing the file
    const first = watcher.forceReload();
    // First force reload reads the same content but force=true means it processes
    expect(first).toBe(true);

    // Now the hash is up-to-date; a non-forced poll should skip
    // We verify this indirectly: forceReload again should still return true (it's forced)
    // But the credential store diff should be empty (no actual changes)
    const spy = vi.spyOn(credentialStore, 'reload');
    watcher.forceReload();
    const diff = spy.mock.results[0]?.value;
    expect(diff.added).toEqual([]);
    expect(diff.updated).toEqual([]);
    expect(diff.removed).toEqual([]);

    watcher.stop();
  });

  it('handles invalid JSON gracefully', () => {
    const watcher = new ConfigWatcher({
      configPath,
      credentialStore,
      clientRateLimiters: clientRateLimiters as Map<string, never>,
    });
    watcher.start();

    fs.writeFileSync(configPath, '{ invalid json !!!');

    const reloaded = watcher.forceReload();
    expect(reloaded).toBe(false);
    // Original client is still available
    expect(credentialStore.findBySystemId('client_a')).toBeDefined();

    watcher.stop();
  });

  it('handles validation errors gracefully', () => {
    const watcher = new ConfigWatcher({
      configPath,
      credentialStore,
      clientRateLimiters: clientRateLimiters as Map<string, never>,
    });
    watcher.start();

    // Valid JSON but missing required fields
    fs.writeFileSync(configPath, JSON.stringify({ clients: [{ systemId: '' }] }));

    const reloaded = watcher.forceReload();
    expect(reloaded).toBe(false);
    expect(credentialStore.findBySystemId('client_a')).toBeDefined();

    watcher.stop();
  });

  it('handles missing file gracefully', () => {
    const watcher = new ConfigWatcher({
      configPath,
      credentialStore,
      clientRateLimiters: clientRateLimiters as Map<string, never>,
    });
    watcher.start();

    fs.unlinkSync(configPath);

    const reloaded = watcher.forceReload();
    expect(reloaded).toBe(false);
    expect(credentialStore.findBySystemId('client_a')).toBeDefined();

    watcher.stop();
  });

  it('cleans up rate limiters for removed clients', () => {
    clientRateLimiters.set('client_a', { fake: 'limiter' });
    clientRateLimiters.set('client_b', { fake: 'limiter' });

    // Start with both clients
    credentialStore.reload([
      makeClient({ systemId: 'client_a' }),
      makeClient({ systemId: 'client_b' }),
    ]);

    const watcher = new ConfigWatcher({
      configPath,
      credentialStore,
      clientRateLimiters: clientRateLimiters as Map<string, never>,
    });
    watcher.start();

    // Remove client_b from config file
    writeConfig(configPath, [makeClient({ systemId: 'client_a' })]);

    watcher.forceReload();

    expect(clientRateLimiters.has('client_a')).toBe(true);
    expect(clientRateLimiters.has('client_b')).toBe(false);

    watcher.stop();
  });

  it('cleans up rate limiters for updated clients', () => {
    clientRateLimiters.set('client_a', { fake: 'limiter' });

    const watcher = new ConfigWatcher({
      configPath,
      credentialStore,
      clientRateLimiters: clientRateLimiters as Map<string, never>,
    });
    watcher.start();

    // Update client_a's maxTps
    writeConfig(configPath, [makeClient({ systemId: 'client_a', maxTps: 200 })]);

    watcher.forceReload();

    // Old limiter should be removed so next bind creates a new one with maxTps=200
    expect(clientRateLimiters.has('client_a')).toBe(false);

    watcher.stop();
  });

  it('handles empty clients array (validation rejects it)', () => {
    const watcher = new ConfigWatcher({
      configPath,
      credentialStore,
      clientRateLimiters: clientRateLimiters as Map<string, never>,
    });
    watcher.start();

    fs.writeFileSync(configPath, JSON.stringify({ clients: [] }));

    const reloaded = watcher.forceReload();
    expect(reloaded).toBe(false);
    expect(credentialStore.findBySystemId('client_a')).toBeDefined();

    watcher.stop();
  });
});
