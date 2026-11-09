type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Local protection for a single deployment instance. Use an edge/WAF limit in multi-instance production. */
export function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const previous = buckets.get(key);
  const bucket = !previous || previous.resetAt <= now ? { count: 0, resetAt: now + windowMs } : previous;
  bucket.count += 1;
  buckets.set(key, bucket);
  return { allowed: bucket.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}
