import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { runSentimentScraper } from '../scrapers/reddit-hn-sentiment.js';

type Bindings = {
  NEON_DATABASE_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// GET /v1/quality-scores - Returns quality scores from Reddit/HN sentiment data
app.get('/v1/quality-scores', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const refresh = c.req.query('refresh') === 'true';
    const model = c.req.query('model');

    if (refresh) {
      // Trigger fresh sentiment scraping from Reddit/HN
      const records = await runSentimentScraper();

      if (model) {
        const filtered = records.filter(r => r.model.toLowerCase() === model.toLowerCase());
        return c.json({
          data: filtered,
          refreshed: true,
          timestamp: new Date().toISOString(),
        });
      }

      return c.json({
        data: records,
        refreshed: true,
        timestamp: new Date().toISOString(),
      });
    }

    // Return cached quality scores from database
    if (model) {
      const scores = await sql`
        SELECT * FROM quality_scores WHERE model = ${model} ORDER BY timestamp DESC
      `;
      return c.json({
        data: scores,
        refreshed: false,
        timestamp: new Date().toISOString(),
      });
    }

    const scores = await sql`
      SELECT * FROM quality_scores ORDER BY score DESC
    `;

    return c.json({
      data: scores,
      refreshed: false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Quality scores endpoint error:', error);
    return c.json({ error: 'Failed to fetch quality scores' }, 500);
  }
});

// POST /v1/quality-scores/refresh - Force refresh sentiment data
app.post('/v1/quality-scores/refresh', async (c) => {
  try {
    const records = await runSentimentScraper();
    return c.json({
      message: 'Quality scores refreshed successfully',
      data: records,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Refresh failed:', error);
    return c.json({ error: 'Failed to refresh quality scores' }, 500);
  }
});

// GET /v1/quality-scores/models - List all models with scores
app.get('/v1/quality-scores/models', async (c) => {
  try {
    const sql = neon(c.env.NEON_DATABASE_URL);
    const models = await sql`
      SELECT model, score, post_count, source, timestamp
      FROM quality_scores
      ORDER BY score DESC
    `;
    return c.json({ data: models, timestamp: new Date().toISOString() });
  } catch (error) {
    return c.json({ error: 'Failed to fetch model list' }, 500);
  }
});

export default app;
