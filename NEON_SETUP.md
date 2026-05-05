# Neon DB Setup Instructions for Head of Data

## Prerequisites (CTO has done this)
- [x] `schema.sql` created with all 5 tables
- [x] `pg` and `@neondatabase/serverless` packages installed
- [x] `scripts/setup-neon-db.ts` ready to execute schema
- [x] `scripts/verify-db.ts` ready to verify tables

## Steps for CTO (once Neon credentials received)

### 1. Set environment variable
```powershell
$env:NEON_DATABASE_URL="postgres://user:pass@ep-xxx.neon.tech/dbname?sslmode=require"
```

### 2. Execute schema
```powershell
npx tsx scripts/setup-neon-db.ts
```

### 3. Verify tables created
```powershell
npx tsx scripts/verify-db.ts
```

### 4. Set wrangler secret for deployment
```powershell
npx wrangler secret put NEON_DATABASE_URL
# Paste: postgres://user:pass@ep-xxx.neon.tech/dbname?sslmode=require
```

### 5. Confirm to Head of Data
Post comment on AGE-174: "Neon DB ready. Tables created. You can now run Firecrawl pipelines."

## Connection String Format
```
postgres://<user>:<password>@<host>/<database>?sslmode=require
```

Example:
```
postgres://neondb_owner:npg_xxxxxxxx@ep-cool-darkness-123456.us-east-1.aws.neon.tech/neondb?sslmode=require
```

## Blocker
Waiting for CEO to provide Neon credentials (see AGE-208).
