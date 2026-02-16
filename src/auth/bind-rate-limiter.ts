import { logger } from '../monitoring/logger.js';

interface IpRecord {
  failures: number;
  blockedUntil: number;
  lastAttempt: number;
}

const MAX_FAILURES = 10;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const DECAY_WINDOW_MS = 10 * 60 * 1000;   // Reset counter after 10 minutes of no attempts

/**
 * Tracks failed bind attempts per IP and blocks IPs that exceed the threshold.
 */
export class BindRateLimiter {
  private ips = new Map<string, IpRecord>();

  /** Returns true if the IP is currently blocked. */
  isBlocked(ip: string): boolean {
    const record = this.ips.get(ip);
    if (!record) return false;

    const now = Date.now();

    // Block expired — reset
    if (record.blockedUntil > 0 && now >= record.blockedUntil) {
      this.ips.delete(ip);
      return false;
    }

    return record.blockedUntil > 0 && now < record.blockedUntil;
  }

  /** Record a failed bind attempt. Blocks the IP if threshold is exceeded. */
  recordFailure(ip: string): void {
    const now = Date.now();
    let record = this.ips.get(ip);

    if (!record) {
      record = { failures: 0, blockedUntil: 0, lastAttempt: now };
      this.ips.set(ip, record);
    }

    // Decay: if last attempt was long ago, reset counter
    if (now - record.lastAttempt > DECAY_WINDOW_MS) {
      record.failures = 0;
    }

    record.failures++;
    record.lastAttempt = now;

    if (record.failures >= MAX_FAILURES) {
      record.blockedUntil = now + BLOCK_DURATION_MS;
      logger.warn({ ip, failures: record.failures }, 'IP blocked due to repeated bind failures');
    }
  }

  /** Record a successful bind. Resets the failure counter for the IP. */
  recordSuccess(ip: string): void {
    this.ips.delete(ip);
  }
}
