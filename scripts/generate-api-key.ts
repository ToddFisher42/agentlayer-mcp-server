/**
 * Generate API keys and insert into Neon database
 *
 * Usage:
 *   export NEON_DATABASE_URL="postgres://user:pass@ep-xxx.neon.tech/dbname?sslmode=require"
 *   npx tsx scripts/generate-api-key.ts [tier] [rate_limit]
 *
 * Examples:
 *   npx tsx scripts/generate-api-key.ts starter 100
 *   npx tsx scripts/generate-api-key.ts pro 500
 *   npx tsx scripts/generate-api-key.ts scale 2000
 */

import { neon } from '@neondatabase/serverless';

function generateApiKey(): string {
  const prefix = 'al_'; // AgentLayer prefix
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return prefix + key;
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generateApiKeyAndInsert() {
  const databaseUrl = process.env.NEON_DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: NEON_DATABASE_URL environment variable not set');
    console.error('Format: postgres://user:pass@ep-xxx.neon.tech/dbname?sslmode=require');
    process.exit(1);
  }

  const tier = process.argv[2] || 'starter';
  const rateLimit = parseInt(process.argv[3]) || 100;

  if (!['starter', 'pro', 'scale'].includes(tier)) {
    console.error('ERROR: tier must be one of: starter, pro, scale');
    process.exit(1);
  }

  console.log('Connecting to Neon database...');
  const sql = neon(databaseUrl);

  try {
    const apiKey = generateApiKey();
    const keyHash = await hashApiKey(apiKey);

    const result = await sql`
      INSERT INTO api_keys (key_hash, tier, rate_limit)
      VALUES (${keyHash}, ${tier}, ${rateLimit})
      RETURNING id, tier, rate_limit, created_at
    `;

    console.log('\n✓ API key generated successfully!');
    console.log('\nIMPORTANT: Save this key securely - it cannot be retrieved again!');
    console.log(`\nAPI Key: ${apiKey}`);
    console.log(`\nKey details:`);
    console.log(`  ID: ${result[0].id}`);
    console.log(`  Tier: ${result[0].tier}`);
    console.log(`  Rate Limit: ${result[0].rate_limit} requests/minute`);
    console.log(`  Created: ${result[0].created_at}`);
    console.log('\nUsage:');
    console.log(`  curl -H "X-API-Key: ${apiKey}" https://your-worker.workers.dev/llm-costs`);

  } catch (error) {
    console.error('Error generating API key:', error);
    process.exit(1);
  }
}

generateApiKeyAndInsert();
