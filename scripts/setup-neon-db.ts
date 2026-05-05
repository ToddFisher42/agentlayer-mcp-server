/**
 * Setup Neon DB - Run this once Neon credentials are available
 * 
 * Usage: 
 *   export NEON_DATABASE_URL="postgres://user:pass@ep-xxx.neon.tech/dbname?sslmode=require"
 *   npx tsx scripts/setup-neon-db.ts
 */

import { neon } from '@neondatabase/serverless';

async function setupDatabase() {
  const databaseUrl = process.env.NEON_DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('ERROR: NEON_DATABASE_URL environment variable not set');
    console.error('Format: postgres://user:pass@ep-xxx.neon.tech/dbname?sslmode=require');
    process.exit(1);
  }

  console.log('Connecting to Neon database...');
  const sql = neon(databaseUrl);

  try {
    // Read and execute schema.sql
    const fs = await import('fs');
    const schema = fs.readFileSync('schema.sql', 'utf8');
    
    console.log('Executing schema.sql...');
    // Execute each statement separately
    const statements = schema.split(';').filter(s => s.trim().length > 0);
    
    for (const stmt of statements) {
      if (stmt.trim()) {
        await sql(stmt);
      }
    }
    
    console.log('Schema created successfully!');
    
    // Verify tables
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    
    console.log('\nTables created:');
    tables.forEach((row: any) => console.log(`  - ${row.table_name}`));
    
    console.log('\nDatabase ready for Head of Data to populate with Firecrawl data.');
    
  } catch (error) {
    console.error('Error setting up database:', error);
    process.exit(1);
  }
}

setupDatabase();
