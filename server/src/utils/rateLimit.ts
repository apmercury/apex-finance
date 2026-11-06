/**
 * Minimal in-memory failure counter for brute-force protection (single process).
 * For multi-instance deployments, move this state to a shared store such as Redis.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

export class FailureLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Seconds until the key may try again, or 0 if it is not blocked. */
  public retryAfter(key: string): number {
    const b = this.buckets.get(key);
    if (!b) return 0;
    const now = Date.now();
    if (now >= b.resetAt) {
      this.buckets.delete(key);
      return 0;
    }
    return b.count >= this.max ? Math.ceil((b.resetAt - now) / 1000) : 0;
  }

  public recordFailure(key: string): void {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || now >= b.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      b.count++;
    }
    // Bound memory: drop expired buckets once the map grows large
    if (this.buckets.size > 10000) {
      for (const [k, v] of this.buckets) if (now >= v.resetAt) this.buckets.delete(k);
    }
  }

  public reset(key: string): void {
    this.buckets.delete(key);
  }
}
