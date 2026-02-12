import { describe, it, expect, vi } from 'vitest';
import { TokenBucketRateLimiter } from '../../src/utils/rate-limiter.js';

describe('TokenBucketRateLimiter', () => {
  it('allows requests within rate limit', () => {
    const limiter = new TokenBucketRateLimiter(10);
    for (let i = 0; i < 10; i++) {
      expect(limiter.tryConsume()).toBe(true);
    }
  });

  it('rejects requests exceeding rate limit', () => {
    const limiter = new TokenBucketRateLimiter(5);
    for (let i = 0; i < 5; i++) {
      limiter.tryConsume();
    }
    expect(limiter.tryConsume()).toBe(false);
  });

  it('refills tokens over time', async () => {
    const limiter = new TokenBucketRateLimiter(10);
    // Consume all tokens
    for (let i = 0; i < 10; i++) {
      limiter.tryConsume();
    }
    expect(limiter.tryConsume()).toBe(false);

    // Wait for refill (10 TPS = 1 token per 100ms)
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(limiter.tryConsume()).toBe(true);
  });

  it('does not exceed max tokens', async () => {
    const limiter = new TokenBucketRateLimiter(3);
    // Wait for potential over-refill
    await new Promise(resolve => setTimeout(resolve, 200));
    // Should only allow max 3
    let consumed = 0;
    while (limiter.tryConsume()) consumed++;
    expect(consumed).toBe(3);
  });
});
