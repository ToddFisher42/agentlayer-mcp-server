import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { Stripe } from 'stripe';
import { runSentimentScraper } from './scrapers/reddit-hn-sentiment.js';
import qualityScoresV1 from './routes/v1-quality-scores.js';

type Bindings = {
  NEON_DATABASE_URL: string;
  FIRECRAWL_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  DB: D1Database;
  RATE_LIMIT_KV: KVNamespace;
};

type Variables = {
  apiKey: string;
  tier: string;
  rateLimit: number;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Hash API key using SHA-256 for database comparison
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Auth middleware - validates API key against database
app.use('*', async (c, next) => {
  const apiKey = c.req.header('X-API-Key') || c.req.query('api_key');
  if (!apiKey) {
    return c.json({ error: 'Missing API key' }, 401);
  }

  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const keyHash = await hashApiKey(apiKey);

    const result = await sql`
      SELECT tier, rate_limit FROM api_keys WHERE key_hash = ${keyHash}
    `;

    if (!result || result.length === 0) {
      return c.json({ error: 'Invalid API key' }, 401);
    }

    const { tier, rate_limit } = result[0];

    // Update last_used timestamp
    await sql`
      UPDATE api_keys SET last_used = NOW() WHERE key_hash = ${keyHash}
    `;

    c.set('apiKey', apiKey);
    c.set('tier', tier || 'starter');
    c.set('rateLimit', rate_limit || 100);
  } catch (error) {
    console.error('API key validation error:', error);
    return c.json({ error: 'Authentication failed' }, 401);
  }

  await next();
});

// Rate limiting middleware using Cloudflare KV for persistence across worker instances
app.use('*', async (c, next) => {
  const apiKey = c.get('apiKey');
  const maxRequests = c.get('rateLimit') || 100;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute

  const kvKey = `rate_limit:${apiKey}`;

  try {
    const stored = await c.env.RATE_LIMIT_KV.get(kvKey, 'json');
    const record = stored as { count: number; resetTime: number } | null;

    if (!record || record.resetTime < now) {
      // First request in window or window expired
      const newRecord = { count: 1, resetTime: now + windowMs };
      await c.env.RATE_LIMIT_KV.put(kvKey, JSON.stringify(newRecord), {
        expirationTtl: Math.ceil(windowMs / 1000), // TTL in seconds
      });
    } else {
      if (record.count >= maxRequests) {
        return c.json({ error: 'Rate limit exceeded', limit: maxRequests }, 429);
      }
      record.count++;
      await c.env.RATE_LIMIT_KV.put(kvKey, JSON.stringify(record), {
        expirationTtl: Math.ceil((record.resetTime - now) / 1000),
      });
    }
  } catch (error) {
    console.error('Rate limit KV error:', error);
    // Fail open - allow request if KV is unavailable
  }

  await next();
});

// Usage logging middleware
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log({
    method: c.req.method,
    path: c.req.path,
    apiKey: c.get('apiKey'),
    tier: c.get('tier'),
    status: c.res.status,
    duration,
    timestamp: new Date().toISOString(),
  });
});

// Error handling
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error', message: err.message }, 500);
});

// GET /llm-costs - Returns LLM pricing data
app.get('/llm-costs', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const costs = await sql`SELECT * FROM llm_costs ORDER BY model_name`;
    return c.json({ data: costs, timestamp: new Date().toISOString() });
  } catch (error) {
    return c.json({ error: 'Failed to fetch LLM costs' }, 500);
  }
});

// GET /model-benchmarks - Returns model benchmark results
app.get('/model-benchmarks', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const benchmarks = await sql`SELECT * FROM model_benchmarks ORDER BY model_name, benchmark_name`;
    return c.json({ data: benchmarks, timestamp: new Date().toISOString() });
  } catch (error) {
    return c.json({ error: 'Failed to fetch model benchmarks' }, 500);
  }
});

// GET /api-deprecations - Returns deprecated API versions
app.get('/api-deprecations', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const deprecations = await sql`SELECT * FROM api_deprecations WHERE deprecated = true ORDER BY deprecation_date`;
    return c.json({ data: deprecations, timestamp: new Date().toISOString() });
  } catch (error) {
    return c.json({ error: 'Failed to fetch API deprecations' }, 500);
  }
});

// Mount v1 routes
app.route('/v1/quality-scores', qualityScoresV1);

// POST /agent-spend - Log agent API spend (x402 micropayment support)
app.post('/agent-spend', async (c) => {
  try {
    const body = await c.req.json();
    const { agent_id, model, tokens_used, cost, payment_receipt } = body;

    if (!agent_id || !model || !tokens_used || !cost) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    // Validate x402 payment receipt if provided
    if (payment_receipt) {
      // TODO: Verify x402 payment receipt
      console.log('x402 payment receipt:', payment_receipt);
    }

    const sql = neon(c.env.NEON_DATABASE_URL);
    const result = await sql`
      INSERT INTO agent_spend (agent_id, model, tokens_used, cost, payment_receipt, timestamp)
      VALUES (${agent_id}, ${model}, ${tokens_used}, ${cost}, ${payment_receipt || null}, ${new Date()})
      RETURNING *
    `;
    return c.json({ data: result[0], timestamp: new Date().toISOString() });
  } catch (error) {
    return c.json({ error: 'Failed to log agent spend' }, 500);
  }
});

// GET /agent-spend - Retrieve agent spend records
app.get('/agent-spend', async (c) => {
  try {
    const agentId = c.req.query('agent_id');
    const sql = neon(c.env.NEON_DATABASE_URL);

    if (agentId) {
      const records = await sql`SELECT * FROM agent_spend WHERE agent_id = ${agentId} ORDER BY timestamp DESC`;
      return c.json({ data: records, timestamp: new Date().toISOString() });
    }

    const records = await sql`SELECT * FROM agent_spend ORDER BY timestamp DESC LIMIT 100`;
    return c.json({ data: records, timestamp: new Date().toISOString() });
  } catch (error) {
    return c.json({ error: 'Failed to fetch agent spend' }, 500);
  }
});

// Stripe webhook endpoint for subscription management
app.post('/webhooks/stripe', async (c) => {
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  const signature = c.req.header('stripe-signature');
  // TODO: Add webhook secret verification
  try {
    const body = await c.req.text();
    const event = stripe.webhooks.constructEvent(body, signature!, '');
    // Handle subscription events
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        console.log('Subscription event:', event.type, event.data.object);
        break;
    }
    return c.json({ received: true });
  } catch (error) {
    return c.json({ error: 'Webhook error' }, 400);
  }
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

export default app;
