import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import axios, { type AxiosInstance } from 'axios';
import { ClientSchema, type ClientConfig, type AuthApiConfig } from '../config/schema.js';
import { logger } from '../monitoring/logger.js';

// Dummy hash used when systemId is not found, to prevent timing enumeration
const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012';

interface CacheEntry {
  client: ClientConfig;
  expiresAt: number;
}

export class CredentialStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly http: AxiosInstance;

  constructor(authApi: AuthApiConfig) {
    this.cacheTtlMs = authApi.cacheTtlMs;
    this.http = axios.create({
      baseURL: authApi.url,
      timeout: 5_000,
      headers: {
        Authorization: authApi.apiKey,
        'Content-Type': 'application/json',
      },
    });
    logger.info({ apiUrl: authApi.url, cacheTtlMs: this.cacheTtlMs }, 'API-backed credential store initialized');
  }

  async verifyPassword(systemId: string, password: string): Promise<ClientConfig | null> {
    const client = await this.fetchClient(systemId);

    if (!client) {
      // Run a dummy bcrypt compare to prevent timing-based systemId enumeration
      await bcrypt.compare(password, DUMMY_HASH).catch(() => {});
      return null;
    }

    const isHash = client.password.startsWith('$2b$') || client.password.startsWith('$2a$');
    let valid: boolean;

    if (isHash) {
      valid = await bcrypt.compare(password, client.password);
    } else {
      // Constant-time comparison for plaintext passwords
      const a = Buffer.from(password);
      const b = Buffer.from(client.password);
      valid = a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    return valid ? client : null;
  }

  isIpAllowed(client: ClientConfig, ip: string): boolean {
    if (!client.allowedIps || client.allowedIps.length === 0) return true;
    // Normalize IPv6-mapped IPv4 addresses
    const normalizedIp = ip.replace(/^::ffff:/, '');
    return client.allowedIps.some(allowed => allowed === normalizedIp || allowed === ip);
  }

  /** Evict a specific systemId from cache, forcing a re-fetch on next request. */
  evict(systemId: string): void {
    this.cache.delete(systemId);
  }

  /** Clear the entire cache. */
  clearCache(): void {
    this.cache.clear();
  }

  private async fetchClient(systemId: string): Promise<ClientConfig | null> {
    // Check cache — return immediately if fresh
    const cached = this.cache.get(systemId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.client.enabled ? cached.client : null;
    }

    // Fetch from API
    try {
      const response = await this.http.get('/api/v1/smpp/auth/', {
        params: { system_id: systemId },
      });

      const result = ClientSchema.safeParse(response.data);
      if (!result.success) {
        logger.error(
          { systemId, errors: result.error.issues },
          'Auth API response failed validation',
        );
        return this.fallbackToStale(systemId);
      }

      const client = result.data;

      // Cache the result (even disabled clients, to avoid hammering the API)
      this.cache.set(systemId, {
        client,
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      return client.enabled ? client : null;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return this.fallbackToStale(systemId, errMsg);
    }
  }

  private fallbackToStale(systemId: string, errorMsg?: string): ClientConfig | null {
    const stale = this.cache.get(systemId);
    if (stale && stale.client.enabled) {
      logger.warn(
        { systemId, error: errorMsg },
        'Auth API unavailable, using stale cached credentials',
      );
      return stale.client;
    }

    if (errorMsg) {
      logger.error(
        { systemId, error: errorMsg },
        'Auth API request failed and no cached credentials available',
      );
    }
    return null;
  }
}
