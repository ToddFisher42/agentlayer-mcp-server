-- AgentLayer MCP Server Database Schema

-- LLM Costs table
CREATE TABLE IF NOT EXISTS llm_costs (
  id SERIAL PRIMARY KEY,
  model_name VARCHAR(255) NOT NULL UNIQUE,
  input_cost_per_1k_tokens DECIMAL(10, 6),
  output_cost_per_1k_tokens DECIMAL(10, 6),
  context_window INTEGER,
  provider VARCHAR(100),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Model Benchmarks table
CREATE TABLE IF NOT EXISTS model_benchmarks (
  id SERIAL PRIMARY KEY,
  model_name VARCHAR(255) NOT NULL,
  benchmark_name VARCHAR(100) NOT NULL,
  score DECIMAL(5, 2),
  dataset VARCHAR(100),
  date_tested DATE,
  source VARCHAR(100),
  UNIQUE(model_name, benchmark_name, date_tested)
);

-- API Deprecations table
CREATE TABLE IF NOT EXISTS api_deprecations (
  id SERIAL PRIMARY KEY,
  api_version VARCHAR(50) NOT NULL UNIQUE,
  endpoint VARCHAR(255),
  deprecated BOOLEAN DEFAULT true,
  deprecation_date DATE,
  sunset_date DATE,
  migration_guide_url TEXT,
  replacement_version VARCHAR(50)
);

-- Quality Scores table (includes Reddit/HN sentiment data)
CREATE TABLE IF NOT EXISTS quality_scores (
  id SERIAL PRIMARY KEY,
  model VARCHAR(255) NOT NULL UNIQUE,
  score DECIMAL(3, 2) NOT NULL,
  post_count INTEGER DEFAULT 0,
  source VARCHAR(255),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agent Spend table (for x402 micropayments)
CREATE TABLE IF NOT EXISTS agent_spend (
  id SERIAL PRIMARY KEY,
  agent_id VARCHAR(255) NOT NULL,
  model VARCHAR(255) NOT NULL,
  tokens_used INTEGER NOT NULL,
  cost DECIMAL(10, 4) NOT NULL,
  payment_receipt TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  tier VARCHAR(50) DEFAULT 'starter',
  rate_limit INTEGER DEFAULT 100,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used TIMESTAMP
);

-- Stripe Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  customer_id VARCHAR(255) NOT NULL,
  subscription_id VARCHAR(255) NOT NULL UNIQUE,
  tier VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  current_period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_spend_agent_id ON agent_spend(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_spend_timestamp ON agent_spend(timestamp);
CREATE INDEX IF NOT EXISTS idx_quality_scores_model ON quality_scores(model);
CREATE INDEX IF NOT EXISTS idx_llm_costs_model ON llm_costs(model_name);
