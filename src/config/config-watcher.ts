import fs from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { ClientSchema } from './schema.js';
import type { ClientConfig } from './schema.js';
import type { CredentialStore } from '../auth/credential-store.js';
import type { TokenBucketRateLimiter } from '../utils/rate-limiter.js';
import { logger } from '../monitoring/logger.js';

interface ConfigWatcherOptions {
  configPath: string;
  credentialStore: CredentialStore;
  clientRateLimiters: Map<string, TokenBucketRateLimiter>;
  pollIntervalMs?: number;
}

const ClientsArraySchema = z.array(ClientSchema).min(1);

export class ConfigWatcher {
  private readonly configPath: string;
  private readonly credentialStore: CredentialStore;
  private readonly clientRateLimiters: Map<string, TokenBucketRateLimiter>;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastContentHash = '';

  constructor(options: ConfigWatcherOptions) {
    this.configPath = options.configPath;
    this.credentialStore = options.credentialStore;
    this.clientRateLimiters = options.clientRateLimiters;
    this.pollIntervalMs = options.pollIntervalMs ?? 30_000;
  }

  start(): void {
    // Compute initial hash so we don't reload on first tick
    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      this.lastContentHash = this.hash(content);
    } catch {
      // Initial load already succeeded in main(), so this is non-fatal
    }

    this.timer = setInterval(() => this.check(), this.pollIntervalMs);
    this.timer.unref();

    logger.info(
      { configPath: this.configPath, pollIntervalMs: this.pollIntervalMs },
      'Config watcher started',
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Force an immediate reload. Returns true if config was reloaded. */
  forceReload(): boolean {
    return this.check(true);
  }

  private check(force = false): boolean {
    let content: string;
    try {
      content = fs.readFileSync(this.configPath, 'utf-8');
    } catch (err) {
      logger.error(
        { configPath: this.configPath, error: String(err) },
        'Config watcher: failed to read config file (keeping current config)',
      );
      return false;
    }

    const contentHash = this.hash(content);
    if (!force && contentHash === this.lastContentHash) {
      return false;
    }

    let clients: ClientConfig[];
    try {
      const parsed = JSON.parse(content);
      const raw = parsed.clients ?? parsed;
      const result = ClientsArraySchema.safeParse(raw);
      if (!result.success) {
        logger.error(
          { errors: result.error.issues },
          'Config watcher: validation failed (keeping current config)',
        );
        return false;
      }
      clients = result.data;
    } catch (err) {
      logger.error(
        { error: String(err) },
        'Config watcher: invalid JSON (keeping current config)',
      );
      return false;
    }

    const diff = this.credentialStore.reload(clients);
    this.lastContentHash = contentHash;

    // Clean up rate limiters for removed and updated clients.
    // Updated clients get a fresh limiter on next bind with new maxTps.
    for (const id of [...diff.removed, ...diff.updated]) {
      this.clientRateLimiters.delete(id);
    }

    return true;
  }

  private hash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
