type Entry = { count: number; resetAt: number; blockedUntil: number };
const attempts = new Map<string, Entry>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const BLOCK_MS = 15 * 60 * 1000;

/** Per-process throttle for local development only; production needs a shared rate-limit store. */
export function isLoginLimited(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.blockedUntil > now) return true;
  if (entry.resetAt <= now) { attempts.delete(key); return false; }
  return false;
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const current = attempts.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS, blockedUntil: 0 } : current;
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) entry.blockedUntil = now + BLOCK_MS;
  attempts.set(key, entry);
  if (attempts.size > 10_000) {
    for (const [candidate, item] of attempts) if (item.resetAt <= now && item.blockedUntil <= now) attempts.delete(candidate);
  }
}

export function clearLoginFailures(key: string): void { attempts.delete(key); }
