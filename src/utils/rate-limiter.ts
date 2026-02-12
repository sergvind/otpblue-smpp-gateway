/**
 * Token bucket rate limiter.
 * Refills tokens at a steady rate and allows bursts up to maxTokens.
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per millisecond

  constructor(maxTps: number) {
    this.maxTokens = maxTps;
    this.tokens = maxTps;
    this.lastRefill = Date.now();
    this.refillRate = maxTps / 1000;
  }

  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}
