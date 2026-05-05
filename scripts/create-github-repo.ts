#!/usr/bin/env npx tsx

/**
 * Create GitHub repository for AgentLayer MCP Server
 * Usage: GITHUB_TOKEN=your_token npx tsx scripts/create-github-repo.ts
 */

const REPO_NAME = 'agentlayer-mcp-server';
const REPO_DESCRIPTION = 'AgentLayer MCP Server - Real-time AI infrastructure data via Model Context Protocol';
const IS_PRIVATE = false;

async function createGitHubRepo() {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    console.error('Error: GITHUB_TOKEN environment variable is required');
    console.error('Get a token at: https://github.com/settings/tokens');
    console.error('');
    console.error('Usage: $env:GITHUB_TOKEN="your_token" ; npx tsx scripts/create-github-repo.ts');
    process.exit(1);
  }

  try {
    const response = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: REPO_NAME,
        description: REPO_DESCRIPTION,
        private: IS_PRIVATE,
        auto_init: false,
        has_issues: true,
        has_projects: false,
        has_wiki: false,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`GitHub API error: ${response.status} ${JSON.stringify(error)}`);
    }

    const repo = await response.json();
    console.log('Repository created successfully!');
    console.log(`URL: ${repo.html_url}`);
    console.log('');
    console.log('Next steps:');
    console.log(`  git remote add origin ${repo.clone_url}`);
    console.log('  git push -u origin master');
    console.log('');
    console.log('Then submit to MCP Hub: https://github.com/modelcontextprotocol/servers/discussions');

    return repo;
  } catch (error) {
    console.error('Failed to create repository:', error);
    process.exit(1);
  }
}

createGitHubRepo();
