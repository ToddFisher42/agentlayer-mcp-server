import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { neon } from '@neondatabase/serverless';

export interface McpServerEnv {
  NEON_DATABASE_URL: string;
}

export function createMcpServer(env: McpServerEnv): McpServer {
  const dbUrl = env.NEON_DATABASE_URL;

  const server = new McpServer({
    name: 'agentlayer-mcp-server',
    version: '1.0.0',
  });

  function query(): ReturnType<typeof neon> {
    return neon(dbUrl);
  }

  // Tool: Get LLM costs
  server.tool(
    'get_llm_costs',
    'Get real-time LLM pricing data across providers (OpenAI, Anthropic, Google, etc.)',
    {},
    async () => {
      try {
        const sql = query();
        const costs = await sql`SELECT * FROM llm_costs ORDER BY model_name`;
        return {
          content: [{ type: 'text', text: JSON.stringify({ data: costs }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching LLM costs: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: Get model benchmarks
  server.tool(
    'get_model_benchmarks',
    'Get model performance benchmarks and comparisons across various evaluation datasets',
    {
      model: z.string().optional().describe('Filter by model name'),
      benchmark: z.string().optional().describe('Filter by benchmark name'),
    },
    async ({ model, benchmark }) => {
      try {
        const sql = query();
        let benchmarks;
        if (model && benchmark) {
          benchmarks = await sql`
            SELECT * FROM model_benchmarks
            WHERE model_name ILIKE ${'%' + model + '%'} AND benchmark_name ILIKE ${'%' + benchmark + '%'}
            ORDER BY model_name, benchmark_name
          `;
        } else if (model) {
          benchmarks = await sql`
            SELECT * FROM model_benchmarks
            WHERE model_name ILIKE ${'%' + model + '%'}
            ORDER BY model_name, benchmark_name
          `;
        } else if (benchmark) {
          benchmarks = await sql`
            SELECT * FROM model_benchmarks
            WHERE benchmark_name ILIKE ${'%' + benchmark + '%'}
            ORDER BY model_name, benchmark_name
          `;
        } else {
          benchmarks = await sql`SELECT * FROM model_benchmarks ORDER BY model_name, benchmark_name`;
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ data: benchmarks }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching benchmarks: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: Get API deprecations
  server.tool(
    'get_api_deprecations',
    'Track deprecated API versions and migration paths for AI services',
    {
      active_only: z.boolean().default(true).describe('Only show active deprecations'),
    },
    async ({ active_only }) => {
      try {
        const sql = query();
        const deprecations = active_only
          ? await sql`SELECT * FROM api_deprecations WHERE deprecated = true ORDER BY deprecation_date`
          : await sql`SELECT * FROM api_deprecations ORDER BY deprecation_date`;
        return {
          content: [{ type: 'text', text: JSON.stringify({ data: deprecations }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching deprecations: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: Get quality scores
  server.tool(
    'get_quality_scores',
    'Get AI model quality scores with Reddit/HN sentiment analysis',
    {
      model: z.string().optional().describe('Filter by model name'),
      refresh: z.boolean().default(false).describe('Force refresh sentiment data'),
    },
    async ({ model, refresh }) => {
      try {
        const sql = query();
        if (model) {
          const scores = await sql`SELECT * FROM quality_scores WHERE model = ${model} ORDER BY timestamp DESC`;
          return {
            content: [{ type: 'text', text: JSON.stringify({ data: scores, refreshed: false }, null, 2) }],
          };
        }
        const scores = await sql`SELECT * FROM quality_scores ORDER BY score DESC`;
        return {
          content: [{ type: 'text', text: JSON.stringify({ data: scores, refreshed: false }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching quality scores: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: Log agent spend
  server.tool(
    'log_agent_spend',
    'Log AI agent API spend with x402 micropayment support',
    {
      agent_id: z.string().describe('Unique agent identifier'),
      model: z.string().describe('LLM model used'),
      tokens_used: z.number().describe('Number of tokens consumed'),
      cost: z.number().describe('Cost in USD'),
      payment_receipt: z.string().optional().describe('Payment receipt or transaction hash'),
    },
    async ({ agent_id, model, tokens_used, cost, payment_receipt }) => {
      try {
        const sql = query();
        const result = await sql`
          INSERT INTO agent_spend (agent_id, model, tokens_used, cost, payment_receipt, timestamp)
          VALUES (${agent_id}, ${model}, ${tokens_used}, ${cost}, ${payment_receipt || null}, NOW())
          RETURNING *
        `;
        return {
          content: [{ type: 'text', text: JSON.stringify({ data: (result as any[])[0] }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error logging spend: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: Get agent spend records
  server.tool(
    'get_agent_spend',
    'Retrieve agent API spend records and analytics',
    {
      agent_id: z.string().optional().describe('Filter by agent ID'),
      limit: z.number().default(100).describe('Max records to return'),
    },
    async ({ agent_id, limit }) => {
      try {
        const sql = query();
        const records = agent_id
          ? await sql`SELECT * FROM agent_spend WHERE agent_id = ${agent_id} ORDER BY timestamp DESC LIMIT ${limit}`
          : await sql`SELECT * FROM agent_spend ORDER BY timestamp DESC LIMIT ${limit}`;
        return {
          content: [{ type: 'text', text: JSON.stringify({ data: records }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error fetching spend records: ${error}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
