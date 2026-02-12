import bcrypt from 'bcrypt';
import type { ClientConfig } from '../config/schema.js';
import { logger } from '../monitoring/logger.js';

export class CredentialStore {
  private clients: Map<string, ClientConfig>;

  constructor(clients: ClientConfig[]) {
    this.clients = new Map();
    for (const client of clients) {
      if (client.enabled) {
        this.clients.set(client.systemId, client);
      }
    }
    logger.info({ count: this.clients.size }, 'Credential store loaded');
  }

  findBySystemId(systemId: string): ClientConfig | undefined {
    return this.clients.get(systemId);
  }

  async verifyPassword(systemId: string, password: string): Promise<ClientConfig | null> {
    const client = this.clients.get(systemId);
    if (!client) return null;

    // Support both bcrypt hashes and plaintext passwords (for dev/testing)
    const isHash = client.password.startsWith('$2b$') || client.password.startsWith('$2a$');
    const valid = isHash
      ? await bcrypt.compare(password, client.password)
      : password === client.password;

    return valid ? client : null;
  }

  isIpAllowed(client: ClientConfig, ip: string): boolean {
    if (!client.allowedIps || client.allowedIps.length === 0) return true;
    // Normalize IPv6-mapped IPv4 addresses
    const normalizedIp = ip.replace(/^::ffff:/, '');
    return client.allowedIps.some(allowed => allowed === normalizedIp || allowed === ip);
  }
}
