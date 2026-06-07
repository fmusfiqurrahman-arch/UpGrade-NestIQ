// Lightweight in-process response cache.
//
// KNOWN LIMITATION — CLUSTER MODE:
// Each PM2 worker has its own in-process Map. When bustListingsCache() is called
// after a write, only the current worker's cache is cleared. Other workers continue
// serving their cached version until its TTL expires (max 60 seconds).
// For most use cases this is acceptable — a brief inconsistency window is better
// than serving stale data forever. If zero-stale-data is required, replace this
// module with a shared Redis cache (ioredis + a single Redis instance).
//
// Cache keys are the full request URL so query params are included automatically.

const store = new Map();

function makeCache(ttlSeconds) {
  return (req, res, next) => {
    const key = req.originalUrl;
    const cached = store.get(key);

    if (cached && Date.now() < cached.expiresAt) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Content-Type', 'application/json');
      return res.send(cached.body);
    }

    // Intercept res.json to capture the response body before sending
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        store.set(key, { body: JSON.stringify(body), expiresAt: Date.now() + ttlSeconds * 1000 });
      }
      res.setHeader('X-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
}

// Call this from routes that mutate listing data so stale cache is evicted immediately
function bustListingsCache() {
  for (const key of store.keys()) {
    if (key.startsWith('/api/listings')) store.delete(key);
  }
}

// Prune expired entries every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of store.entries()) {
    if (now >= val.expiresAt) store.delete(key);
  }
}, 5 * 60 * 1000);

module.exports = { makeCache, bustListingsCache };
