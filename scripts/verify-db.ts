/**
 * Verify Neon DB is properly set up with all required tables
 * 
 * Usage: 
 *   export NEON_DATABASE_URL="postgres://user:pass@ep-xxx.neon.tech/dbname?sslmode=require"
 *   npx tsx scripts/verify-db.ts
 */

import { neon } from '@neondatabase/serverless';

const REQUIRED_TABLES = [
  'llm_costs',
  'model_benchmarks', 
  'api_deprecations',
  'quality_scores',
  'agent_spend',
  'api_keys',
  'subscriptions'
];

async function verifyDatabase() {
  const databaseUrl = process.env.NEON_DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('ERROR: NEON_DATABASE_URL not set');
    process.exit(1);
  }

  console.log('Verifying Neon database...\n');
  const sql = neon(databaseUrl);

  try {
    // Check all required tables exist
    const result = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    
    const existingTables = result.map((r: any) => r.table_name);
    
    console.log('Tables found:');
    let allGood = true;
    
    for (const table of REQUIRED_TABLES) {
      if (existingTables.includes(table)) {
        console.log(`  ✓ ${table}`);
      } else {
        console.log(`  ✗ ${table} - MISSING`);
        allGood = false;
      }
    }
    
    // Check row counts
    console.log('\nRow counts:');
    for (const table of REQUIRED_TABLES) {
      if (existingTables.includes(table)) {
        const count = await sql`SELECT COUNT(*) as count FROM ${sql(table)}`;
        console.log(`  ${table}: ${count[0].count} rows`);
      }
    }
    
    if (allGood) {
      console.log('\n✓ Database ready for Head of Data pipelines!');
    } else {
      console.log('\n✗ Some tables missing. Run: npx tsx scripts/setup-neon-db.ts');
    }
    
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
}

verifyDatabase();
