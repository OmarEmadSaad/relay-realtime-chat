// A small in-memory fixed-window rate limiter, shared by REST and Socket.IO:
//   const limiter = createRateLimiter({ windowMs: 10_000, max: 10 });
//   if (!limiter.hit(userId)) { ...too many... }
// max may be a function, read on every hit (e.g. from process.env).
// In-memory means per process: with several server instances behind a load
// balancer, use a shared store (e.g. Redis) instead.
export interface RateLimiterOptions {
  windowMs: number;
  max: number | (() => number);
}

export interface RateLimiter {
  hit(key: string): boolean;
  retryAfter(key: string): number;
}

export const createRateLimiter = ({ windowMs, max }: RateLimiterOptions): RateLimiter => {
  const windows = new Map<string, { count: number; resetAt: number }>();

  // Forget expired windows so the map doesn't grow forever
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }
  }, windowMs);
  sweep.unref(); // don't keep the process (or a test run) alive

  return {
    // Counts one hit; false when the key is over its limit
    hit(key) {
      const now = Date.now();
      let window = windows.get(key);
      if (!window || window.resetAt <= now) {
        window = { count: 0, resetAt: now + windowMs };
        windows.set(key, window);
      }
      window.count += 1;
      return window.count <= (typeof max === "function" ? max() : max);
    },
    // Seconds until the key may try again
    retryAfter(key) {
      const window = windows.get(key);
      return window ? Math.max(0, Math.ceil((window.resetAt - Date.now()) / 1000)) : 0;
    },
  };
};
