import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import type { ClientConfig } from '../config/schema.js';
import { logger } from '../monitoring/logger.js';

// Dummy hash used when systemId is not found, to prevent timing enumeration
const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012';

export class CredentialStore {
  private clients: Map<string, ClientConfig>;

  constructor(clients: ClientConfig[]) {
    this.clients = this.buildClientMap(clients);
    logger.info({ count: this.clients.size }, 'Credential store loaded');
  }

  /**
   * Atomically replace the client map with new configuration.
   * New binds will use updated credentials; existing sessions are unaffected
   * because they hold their own reference to the old ClientConfig object.
   */
  reload(clients: ClientConfig[]): { added: string[]; updated: string[]; removed: string[] } {
    const newMap = this.buildClientMap(clients);

    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];

    for (const [id, client] of newMap) {
      if (!this.clients.has(id)) {
        added.push(id);
      } else if (JSON.stringify(this.clients.get(id)) !== JSON.stringify(client)) {
        updated.push(id);
      }
    }
    for (const id of this.clients.keys()) {
      if (!newMap.has(id)) {
        removed.push(id);
      }
    }

    this.clients = newMap;

    if (added.length || updated.length || removed.length) {
      logger.info({ added, updated, removed, total: newMap.size }, 'Credential store reloaded');
    }

    return { added, updated, removed };
  }

  private buildClientMap(clients: ClientConfig[]): Map<string, ClientConfig> {
    const map = new Map<string, ClientConfig>();
    for (const client of clients) {
      if (client.enabled) {
        map.set(client.systemId, client);

        const isHash = client.password.startsWith('$2b$') || client.password.startsWith('$2a$');
        if (!isHash) {
          logger.warn(
            { systemId: client.systemId },
            'Client uses plaintext password. Use bcrypt hashes in production (e.g. npx bcrypt-cli hash "password")',
          );
        }
      }
    }
    return map;
  }

  findBySystemId(systemId: string): ClientConfig | undefined {
    return this.clients.get(systemId);
  }

  async verifyPassword(systemId: string, password: string): Promise<ClientConfig | null> {
    const client = this.clients.get(systemId);

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
}
