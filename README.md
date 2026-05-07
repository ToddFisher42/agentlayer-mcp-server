# AgentLayer MCP Server

<!-- mcp-name: io.github.ToddFisher42/agentlayer-mcp-server -->

A Model Context Protocol (MCP) server providing real-time AI infrastructure data via TypeScript + Hono on Cloudflare Workers.

## Overview

AgentLayer MCP Server exposes 5 endpoints for AI agent consumption:

| Endpoint | Description |
|----------|-------------|
| `/llm-costs` | Real-time LLM pricing data across providers |
| `/model-benchmarks` | Model performance benchmarks and comparisons |
| `/api-deprecations` | Track deprecated API versions and migration paths |
| `/quality-scores` | AI model quality scores with sentiment analysis |
| `/agent-spend` | Agent API spend tracking with x402 micropayment support |

## Features

- **Authentication**: API key auth on all endpoints
- **Rate Limiting**: Configurable per-API-key limits
- **Usage Logging**: Full request/response logging
- **Error Handling**: Comprehensive error handling with meaningful responses
- **x402 Micropayments**: Native support for x402 payment protocol
- **Stripe Billing**: Subscription tiers (Starter $99/mo, Pro $299/mo, Scale $499/mo)
- **Sentiment Analysis**: Automated Reddit/HN scraping for model sentiment scores

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono (lightweight, fast)
- **Language**: TypeScript
- **Database**: Neon Postgres (serverless)
- **Payments**: Stripe + x402 protocol
- **Data Ingestion**: Firecrawl API

## Quick Start

### Prerequisites

- Node.js 20+
- Cloudflare account
- Neon database
- Stripe account
- Firecrawl API key

### Installation

```bash
npm install
```

### Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required variables:
- `NEON_DATABASE_URL` - Neon Postgres connection string
- `FIRECRAWL_API_KEY` - Firecrawl API key
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_STARTER_PRICE_ID` - Stripe price ID for Starter tier
- `STRIPE_PRO_MONTHLY_PRICE_ID` - Stripe price ID for Pro tier
- `STRIPE_SCALE_MONTHLY_PRICE_ID` - Stripe price ID for Scale tier

### Database Setup

```bash
# Apply schema to Neon
npx tsx scripts/setup-neon-db.ts

# Verify tables created
npx tsx scripts/verify-db.ts
```

### Development

```bash
npm run dev
```

### Deploy

```bash
npm run deploy
```

## API Documentation

### Authentication

All endpoints require an API key via header or query parameter:

```bash
X-API-Key: your-api-key
# or
?api_key=your-api-key
```

### Endpoints

#### GET /llm-costs

Returns LLM pricing data.

```bash
curl -H "X-API-Key: your-key" https://your-worker.workers.dev/llm-costs
```

#### GET /model-benchmarks

Returns model benchmark results.

```bash
curl -H "X-API-Key: your-key" https://your-worker.workers.dev/model-benchmarks
```

#### GET /api-deprecations

Returns deprecated API versions.

```bash
curl -H "X-API-Key: your-key" https://your-worker.workers.dev/api-deprecations
```

#### GET/POST /quality-scores

Quality scores with optional sentiment refresh.

```bash
# Get scores
curl -H "X-API-Key: your-key" https://your-worker.workers.dev/v1/quality-scores

# Trigger sentiment refresh
curl -H "X-API-Key: your-key" "https://your-worker.workers.dev/v1/quality-scores?refresh=true"
```

#### POST /agent-spend

Log agent API spend with x402 micropayment support.

```bash
curl -X POST -H "X-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"agent-123","model":"gpt-4","tokens_used":1500,"cost":0.045,"payment_receipt":"x402-receipt"}' \
  https://your-worker.workers.dev/agent-spend
```

#### GET /agent-spend

Retrieve agent spend records.

```bash
curl -H "X-API-Key: your-key" "https://your-worker.workers.dev/agent-spend?agent_id=agent-123"
```

## MCP Hub Submission

### Registry Submission (registry.modelcontextprotocol.io)

This server is published to the official MCP Registry. To submit updates:

1. Install the MCP publisher CLI:
   ```bash
   brew install modelcontextprotocol/tap/mcp-publisher
   # or download from: https://github.com/modelcontextprotocol/registry/releases
   ```

2. Authenticate with GitHub:
   ```bash
   mcp-publisher login github
   ```

3. Publish to registry:
   ```bash
   mcp-publisher publish
   ```

### MCP Hub Directory (mcphub.net / mcpserverhub.com)

Submit your server at:
- https://www.mcp-servers-hub.net/submit
- https://mcpserverhub.com/en/submit

**Server details:**
- **Name**: AgentLayer MCP Server
- **Category**: AI Infrastructure / Data & Analytics
- **Description**: Real-time AI infrastructure data (costs, benchmarks, deprecations, quality scores, spend tracking)
- **Repository**: https://github.com/ToddFisher42/agentlayer-mcp-server
- **Demo URL**: https://agentlayer-mcp-server.your-subdomain.workers.dev/mcp

### MCP Endpoint

The server exposes an MCP-compatible endpoint at `/mcp` using Streamable HTTP transport:

```json
{
  "mcpServers": {
    "agentlayer": {
      "url": "https://agentlayer-mcp-server.your-subdomain.workers.dev/mcp"
    }
  }
}
```

### Available MCP Tools (6 tools)

| Tool | Description |
|------|-------------|
| `get_llm_costs` | Get real-time LLM pricing data across providers |
| `get_model_benchmarks` | Get model performance benchmarks |
| `get_api_deprecations` | Track deprecated API versions |
| `get_quality_scores` | Get AI model quality scores with sentiment analysis |
| `log_agent_spend` | Log AI agent API spend with x402 micropayment support |
| `get_agent_spend` | Retrieve agent API spend records |

## Architecture

```
src/
├── index.ts                    # Main Hono app with all endpoints
├── routes/
│   └── v1-quality-scores.ts   # Quality scores route with sentiment refresh
└── scrapers/
    └── reddit-hn-sentiment.ts # Reddit/HN sentiment scraper via Firecrawl
```

## CI/CD

GitHub Actions workflow (`.github/workflows/deploy.yml`):
- Runs on push to `main`
- Type checks with TypeScript
- Deploys to Cloudflare Workers

Required GitHub secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `NEON_DATABASE_URL`
- `FIRECRAWL_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_STARTER_PRICE_ID`
- `STRIPE_PRO_MONTHLY_PRICE_ID`
- `STRIPE_SCALE_MONTHLY_PRICE_ID`

## License

MIT

## Support

For issues and feature requests, please use the GitHub issue tracker.
