/**
 * Convention Resolver
 * Deterministic, zero-latency matching before the LLM is ever called.
 * If a match is found here, no API call is made.
 */

import type {
  FrontendIntent,
  BackendCapability,
  Contract,
  ContractSource,
} from '../manifest/types.js';
import { generateId, now } from '../utils.js';

interface ConventionMatch {
  capability: BackendCapability;
  confidence: number;
  reasoning: string;
}

// ─── SCORING WEIGHTS ─────────────────────────────────────────────────────────

const WEIGHTS = {
  exactNameMatch: 1.0,
  nameTokenOverlap: 0.6,
  tagOverlap: 0.5,
  actionMatch: 0.3,
  shapeCompatibility: 0.4,
  semanticSynonym: 0.4,
};

// Common semantic synonyms the convention layer understands without LLM
const SYNONYMS: Record<string, string[]> = {
  list: ['get', 'fetch', 'read', 'find', 'search', 'query', 'all', 'index'],
  create: ['add', 'new', 'insert', 'post', 'make', 'register', 'save'],
  update: ['edit', 'modify', 'change', 'patch', 'put', 'set'],
  delete: ['remove', 'destroy', 'drop', 'purge', 'clear'],
  user: ['users', 'user', 'member', 'members', 'account', 'accounts', 'profile', 'profiles', 'person', 'people'],
  order: ['orders', 'purchase', 'purchases', 'transaction', 'transactions', 'sale', 'sales'],
  product: ['products', 'item', 'items', 'sku', 'catalog'],
  auth: ['login', 'logout', 'signin', 'signout', 'authenticate', 'session'],
  dashboard: ['stats', 'metrics', 'analytics', 'summary', 'overview'],
  store: ['shops', 'shop', 'store', 'branch'],
};

function normalize(str: string): string {
  return str.toLowerCase().replace(/[-_\/\s]+/g, ' ').trim();
}

function tokenize(str: string): string[] {
  return normalize(str).split(' ').filter(Boolean);
}

function expandWithSynonyms(tokens: string[]): Set<string> {
  const expanded = new Set<string>(tokens);
  for (const token of tokens) {
    for (const [canonical, synonymList] of Object.entries(SYNONYMS)) {
      if (token === canonical || synonymList.includes(token)) {
        expanded.add(canonical);
        synonymList.forEach(s => expanded.add(s));
      }
    }
  }
  return expanded;
}

function tokenOverlapScore(a: string, b: string): number {
  const tokensA = expandWithSynonyms(tokenize(a));
  const tokensB = expandWithSynonyms(tokenize(b));
  
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : overlap / union;
}

function tagOverlapScore(
  intentTags: string[] = [],
  capTags: string[] = []
): number {
  if (intentTags.length === 0 || capTags.length === 0) return 0;
  
  const a = new Set(intentTags.map(t => t.toLowerCase()));
  const b = new Set(capTags.map(t => t.toLowerCase()));
  
  let overlap = 0;
  for (const t of a) {
    if (b.has(t)) overlap++;
  }
  
  return overlap / Math.max(a.size, b.size);
}

function actionMatchScore(
  intentAction?: string,
  capMethod?: string
): number {
  if (!intentAction || !capMethod) return 0;
  
  const methodMap: Record<string, string[]> = {
    read: ['GET'],
    create: ['POST'],
    update: ['PUT', 'PATCH'],
    delete: ['DELETE'],
    subscribe: ['GET'],
  };
  
  const expectedMethods = methodMap[intentAction] || [];
  return expectedMethods.includes(capMethod.toUpperCase()) ? 1 : 0;
}

function shapeCompatibilityScore(
  intent: FrontendIntent,
  cap: BackendCapability
): number {
  if (!intent.requiredFields || intent.requiredFields.length === 0) return 0.5;
  
  const outputKeys = Object.keys(cap.output || {});
  if (outputKeys.length === 0) return 0;
  
  const satisfied = intent.requiredFields.filter(f =>
    outputKeys.some(k => k.toLowerCase() === f.toLowerCase())
  );
  
  return satisfied.length / intent.requiredFields.length;
}

// ─── MAIN RESOLVER ────────────────────────────────────────────────────────────

export class ConventionResolver {
  private readonly CONFIDENCE_THRESHOLD = 0.55;

  resolve(
    intent: FrontendIntent,
    capabilities: BackendCapability[]
  ): ConventionMatch | null {
    if (capabilities.length === 0) return null;

    let bestMatch: ConventionMatch | null = null;
    let bestScore = 0;

    for (const cap of capabilities) {
      const score = this.scoreMatch(intent, cap);
      if (score.total > bestScore) {
        bestScore = score.total;
        bestMatch = {
          capability: cap,
          confidence: score.total,
          reasoning: this.buildReasoning(score),
        };
      }
    }

    if (!bestMatch || bestMatch.confidence < this.CONFIDENCE_THRESHOLD) {
      return null;
    }

    return bestMatch;
  }

  private scoreMatch(
    intent: FrontendIntent,
    cap: BackendCapability
  ): Record<string, number> & { total: number } {
    // Exact name match is an instant high-confidence hit
    if (normalize(intent.name) === normalize(cap.name)) {
      return {
        exactName: WEIGHTS.exactNameMatch,
        total: WEIGHTS.exactNameMatch,
      };
    }

    const nameScore =
      tokenOverlapScore(intent.name, cap.name) * WEIGHTS.nameTokenOverlap;
    const descScore =
      intent.description && cap.description
        ? tokenOverlapScore(intent.description, cap.description) * 0.2
        : 0;
    const tagScore =
      tagOverlapScore(intent.tags, cap.tags) * WEIGHTS.tagOverlap;
    const actionScore =
      actionMatchScore(intent.action, cap.method) * WEIGHTS.actionMatch;
    const shapeScore =
      shapeCompatibilityScore(intent, cap) * WEIGHTS.shapeCompatibility;

    const total = Math.min(
      1,
      nameScore + descScore + tagScore + actionScore + shapeScore
    );

    return { nameScore, descScore, tagScore, actionScore, shapeScore, total };
  }

  private buildReasoning(scores: Record<string, number>): string {
    const parts: string[] = [];
    if (scores.exactName) parts.push('exact name match');
    if (scores.nameScore > 0.3) parts.push(`name token overlap (${(scores.nameScore * 100).toFixed(0)}%)`);
    if (scores.tagScore > 0.2) parts.push(`tag overlap (${(scores.tagScore * 100).toFixed(0)}%)`);
    if (scores.actionScore > 0) parts.push('HTTP method matches intent action');
    if (scores.shapeScore > 0.3) parts.push(`output shape compatible (${(scores.shapeScore * 100).toFixed(0)}%)`);
    return parts.join(', ') || 'partial match';
  }

  buildContract(
    match: ConventionMatch,
    intent: FrontendIntent,
    appId: string,
    serviceId: string
  ): Contract {
    const cap = match.capability;
    const endpoint = this.deriveEndpoint(intent, cap);

    return {
      id: generateId(),
      intentId: intent.id,
      capabilityId: cap.id,
      appId,
      serviceId,
      source: 'convention' as ContractSource,
      confidence: match.confidence,
      reasoning: match.reasoning,
      generatedEndpoint: endpoint,
      httpMethod: cap.method || 'GET',
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
      usageCount: 0,
      requiresApproval: match.confidence < 0.8,
    };
  }

  private deriveEndpoint(intent: FrontendIntent, cap: BackendCapability): string {
    const slug = normalize(intent.name)
      .replace(/\s+/g, '/')
      .replace(/[^a-z0-9\/]/g, '');
    return `/bridge/${slug}`;
  }
}
