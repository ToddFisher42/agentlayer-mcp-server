import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import Stripe from 'stripe';
import { StripeBillingService, StripeBillingConfig } from './services/stripe-billing.js';
import { runSentimentScraper } from './scrapers/reddit-hn-sentiment.js';
import qualityScoresV1 from './routes/v1-quality-scores.js';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { StreamableHTTPTransport } from '@hono/mcp';
import { createMcpServer, McpServerEnv } from './mcp-server.js';

// Cloudflare Workers types
type D1Database = any;
type KVNamespace = any;

type Bindings = {
  NEON_DATABASE_URL: string;
  FIRECRAWL_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_STARTER_PRICE_ID: string;
  STRIPE_PRO_MONTHLY_PRICE_ID: string;
  STRIPE_SCALE_MONTHLY_PRICE_ID: string;
  X402_PAYMENT_ADDRESS: string;
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

// Mount quality-scores endpoint (spec: /quality-scores)
app.route('/quality-scores', qualityScoresV1);

// POST /agent-spend - Log agent API spend (x402 micropayment support)
app.post('/agent-spend', async (c) => {
  try {
    const body = await c.req.json();
    const { agent_id, model, tokens_used, cost, payment_receipt, payment_payload } = body;

    if (!agent_id || !model || !tokens_used || !cost) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    // Verify x402 payment if payment_payload is provided
    if (payment_payload) {
      try {
        const facilitatorClient = new HTTPFacilitatorClient();

        // Build payment requirements for this endpoint
        const paymentRequirements: any = {
          scheme: 'exact',
          network: 'base',
          amount: Math.round(cost * 1000000).toString(), // Convert to atomic units (6 decimals for USDC)
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA0293',
          payTo: c.env.X402_PAYMENT_ADDRESS || '0x0000000000000000000000000000000000000000',
          maxTimeoutSeconds: 300,
          extra: {},
        };

        // Verify the payment with the facilitator
        const verifyResult = await facilitatorClient.verify(payment_payload, paymentRequirements);

        if (!verifyResult.isValid) {
          return c.json({
            error: 'Payment verification failed',
            reason: verifyResult.invalidReason,
            message: verifyResult.invalidMessage,
          }, 402);
        }

        // Settle the payment after successful verification
        const settleResult = await facilitatorClient.settle(payment_payload, paymentRequirements);

        if (!settleResult.success) {
          return c.json({
            error: 'Payment settlement failed',
            reason: settleResult.errorReason,
            message: settleResult.errorMessage,
          }, 402);
        }

        console.log('x402 payment verified and settled:', settleResult.transaction);
      } catch (paymentError) {
        console.error('x402 payment verification error:', paymentError);
        return c.json({ error: 'Payment verification failed', details: (paymentError as Error).message }, 402);
      }
    } else if (!payment_receipt) {
      // No payment provided - require payment for agent spend
      return c.json({
        error: 'Payment required',
        x402: {
          version: 2,
          accepts: [{
            scheme: 'exact',
            network: 'base',
            amount: Math.round(cost * 1000000).toString(),
            asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA0293',
            payTo: c.env.X402_PAYMENT_ADDRESS || '0x0000000000000000000000000000000000000000',
            maxTimeoutSeconds: 300,
            extra: {},
          }],
        },
      }, 402);
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
  const signature = c.req.header('stripe-signature');

  if (!signature) {
    return c.json({ error: 'Missing stripe-signature header' }, 400);
  }

  try {
    const body = await c.req.text();

    const config: StripeBillingConfig = {
      starterPriceId: c.env.STRIPE_STARTER_PRICE_ID,
      proPriceId: c.env.STRIPE_PRO_MONTHLY_PRICE_ID,
      scalePriceId: c.env.STRIPE_SCALE_MONTHLY_PRICE_ID,
      databaseUrl: c.env.NEON_DATABASE_URL,
    };

    const billingService = new StripeBillingService(c.env.STRIPE_SECRET_KEY, config);
    const event = await billingService.handleWebhookEvent(body, signature, c.env.STRIPE_WEBHOOK_SECRET);

    return c.json({ received: true, type: event.type });
  } catch (error) {
    console.error('Webhook error:', error);
    return c.json({ error: 'Webhook verification failed' }, 400);
  }
});

// Stripe checkout endpoints for subscription tiers
app.post('/checkout/:tier', async (c) => {
  try {
    const tier = c.req.param('tier').toLowerCase();
    const { email, success_url, cancel_url } = await c.req.json();

    if (!email || !success_url || !cancel_url) {
      return c.json({ error: 'Missing required fields: email, success_url, cancel_url' }, 400);
    }

    const validTiers = ['starter', 'pro', 'scale'];
    if (!validTiers.includes(tier)) {
      return c.json({ error: `Invalid tier. Must be one of: ${validTiers.join(', ')}` }, 400);
    }

    const config: StripeBillingConfig = {
      starterPriceId: c.env.STRIPE_STARTER_PRICE_ID,
      proPriceId: c.env.STRIPE_PRO_MONTHLY_PRICE_ID,
      scalePriceId: c.env.STRIPE_SCALE_MONTHLY_PRICE_ID,
      databaseUrl: c.env.NEON_DATABASE_URL,
    };

    const billingService = new StripeBillingService(c.env.STRIPE_SECRET_KEY, config);

    // Get or create customer
    const customer = await billingService.findOrCreateCustomer(email);

    const session = await billingService.createCheckoutSession(
      customer.id,
      tier,
      success_url,
      cancel_url
    );

    return c.json({ session_id: session.id, url: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    return c.json({ error: 'Failed to create checkout session' }, 500);
  }
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// MCP Protocol endpoint - Streamable HTTP transport
app.all('/mcp', async (c) => {
  try {
    const mcpServerEnv: McpServerEnv = {
      NEON_DATABASE_URL: c.env.NEON_DATABASE_URL,
    };
    const mcpServer = createMcpServer(mcpServerEnv);
    const transport = new StreamableHTTPTransport();
    await mcpServer.connect(transport);
    return transport.handleRequest(c);
  } catch (error) {
    console.error('MCP handler error:', error);
    return c.json({ error: 'MCP request failed', message: (error as Error).message }, 500);
  }
});

export default app;
