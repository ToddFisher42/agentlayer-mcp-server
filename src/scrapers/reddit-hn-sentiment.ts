import { neon } from '@neondatabase/serverless';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY!;
const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL!;

const AI_MODELS = ['GPT-4', 'GPT-3.5', 'Claude 3', 'Claude 2', 'Llama 3', 'Llama 2', 'Mistral', 'Gemini', 'PaLM'] as const;
const POSITIVE_WORDS = ['great', 'good', 'excellent', 'impressive', 'works well', 'better', 'faster', 'accurate', 'reliable'];
const NEGATIVE_WORDS = ['bad', 'poor', 'slow', 'inaccurate', 'terrible', 'worse', 'buggy', 'expensive', 'unreliable'];

interface Post {
  title: string;
  text: string;
  url: string;
  created: number;
  source: 'reddit' | 'hackernews';
}

interface QualityScoreRecord {
  model: string;
  score: number;
  post_count: number;
  source: string;
  timestamp: Date;
}

async function scrapeWithFirecrawl(url: string): Promise<any> {
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ['json'],
    }),
  });
  if (!response.ok) throw new Error(`Firecrawl scrape failed: ${response.statusText}`);
  return response.json();
}

async function scrapeReddit(subreddit: string): Promise<Post[]> {
  try {
    const data = await scrapeWithFirecrawl(`https://www.reddit.com/r/${subreddit}/new.json?limit=100`);
    return data.data.children.map((child: any) => ({
      title: child.data.title,
      text: child.data.selftext || '',
      url: `https://reddit.com${child.data.permalink}`,
      created: child.data.created_utc,
      source: 'reddit' as const,
    }));
  } catch (error) {
    console.error(`Failed to scrape Reddit r/${subreddit}:`, error);
    return [];
  }
}

async function scrapeHN(): Promise<Post[]> {
  try {
    const storyIdsRes = await fetch('https://hacker-news.firebaseio.com/v0/newstories.json');
    const storyIds: number[] = await storyIdsRes.json();
    const top100 = storyIds.slice(0, 100);
    const stories = await Promise.all(top100.map(async (id) => {
      const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      return res.json();
    }));
    const aiKeywords = ['AI', 'LLM', 'GPT', 'Claude', 'Llama', 'Mistral', 'Gemini'];
    return stories
      .filter((story: any) => story.title && aiKeywords.some(kw => story.title.includes(kw)))
      .map((story: any) => ({
        title: story.title,
        text: story.text || '',
        url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
        created: story.time,
        source: 'hackernews' as const,
      }));
  } catch (error) {
    console.error('Failed to scrape HN:', error);
    return [];
  }
}

function extractModels(text: string): string[] {
  const lowerText = text.toLowerCase();
  return AI_MODELS.filter(model => lowerText.includes(model.toLowerCase()));
}

function computeSentiment(text: string): number {
  const lowerText = text.toLowerCase();
  let score = 0;
  POSITIVE_WORDS.forEach(word => {
    if (lowerText.includes(word)) score += 1;
  });
  NEGATIVE_WORDS.forEach(word => {
    if (lowerText.includes(word)) score -= 1;
  });
  return Math.max(0, Math.min(1, (score + 5) / 10));
}

async function aggregateAndStoreScores(posts: Post[]): Promise<QualityScoreRecord[]> {
  const sql = neon(NEON_DATABASE_URL);
  const modelData: Record<string, { total: number; count: number; sources: Set<string> }> = {};

  for (const post of posts) {
    const models = extractModels(`${post.title} ${post.text}`);
    const sentiment = computeSentiment(`${post.title} ${post.text}`);
    for (const model of models) {
      if (!modelData[model]) {
        modelData[model] = { total: 0, count: 0, sources: new Set() };
      }
      modelData[model].total += sentiment;
      modelData[model].count += 1;
      modelData[model].sources.add(post.source);
    }
  }

  const records: QualityScoreRecord[] = [];
  for (const [model, { total, count, sources }] of Object.entries(modelData)) {
    const score = total / count;
    const record = {
      model,
      score,
      post_count: count,
      source: Array.from(sources).join(','),
      timestamp: new Date(),
    };
    records.push(record);
    await sql`
      INSERT INTO quality_scores (model, score, post_count, source, timestamp)
      VALUES (${model}, ${score}, ${count}, ${record.source}, ${record.timestamp})
      ON CONFLICT (model) DO UPDATE SET
        score = EXCLUDED.score,
        post_count = EXCLUDED.post_count,
        source = EXCLUDED.source,
        timestamp = EXCLUDED.timestamp
    `;
  }
  return records;
}

export async function runSentimentScraper(): Promise<QualityScoreRecord[]> {
  console.log('Starting Reddit/HN sentiment scraper...');
  const [redditPosts, hnPosts] = await Promise.all([
    Promise.all([
      scrapeReddit('MachineLearning'),
      scrapeReddit('LocalLLaMA'),
      scrapeReddit('artificial'),
    ]),
    scrapeHN(),
  ]);
  const allPosts = [...redditPosts.flat(), ...hnPosts];
  console.log(`Scraped ${allPosts.length} total posts`);
  const records = await aggregateAndStoreScores(allPosts);
  console.log(`Stored ${records.length} quality score records`);
  return records;
}
