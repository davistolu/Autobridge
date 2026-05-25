/**
 * LLM Synthesizer
 * Called only when convention resolution fails.
 * Uses Claude to reason about intent ↔ capability matching,
 * then promotes the result to a contract so it's never called again for the same pair.
 */

import type {
  FrontendIntent,
  BackendCapability,
  Contract,
  ContractTransform,
} from '../manifest/types.js';
import { generateId, now } from '../utils.js';

interface LLMResolutionResult {
  matched: boolean;
  capabilityId: string | null;
  confidence: number;
  reasoning: string;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpointSlug: string;
  requestTransform?: string;
  responseTransform?: string;
}

interface KeyConfig {
  apiKey: string;
  model?: string;
}

export class LLMSynthesizer {
  private readonly DEFAULT_MODEL = 'claude-sonnet-4-20250514';

  async resolve(
    intent: FrontendIntent,
    capabilities: BackendCapability[],
    keyConfig: KeyConfig
  ): Promise<{ contract: Contract | null; reasoning: string }> {
    const { apiKey, model = this.DEFAULT_MODEL } = keyConfig;

    if (!apiKey) {
      return {
        contract: null,
        reasoning: 'No API key provided — LLM synthesis skipped.',
      };
    }

    const prompt = this.buildPrompt(intent, capabilities);

    let rawResponse: string;
    try {
      rawResponse = await this.callClaude(prompt, apiKey, model);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        contract: null,
        reasoning: `LLM call failed: ${msg}`,
      };
    }

    const result = this.parseResponse(rawResponse);

    if (!result.matched || !result.capabilityId) {
      return {
        contract: null,
        reasoning: result.reasoning || 'LLM could not find a suitable match.',
      };
    }

    const matchedCap = capabilities.find(c => c.id === result.capabilityId);
    if (!matchedCap) {
      return {
        contract: null,
        reasoning: `LLM returned unknown capability ID: ${result.capabilityId}`,
      };
    }

    // Build the appId placeholder — caller will fill this in
    const contract: Contract = {
      id: generateId(),
      intentId: intent.id,
      capabilityId: matchedCap.id,
      appId: '__pending__',
      serviceId: '__pending__',
      source: 'llm',
      confidence: result.confidence,
      reasoning: result.reasoning,
      generatedEndpoint: `/bridge/${result.endpointSlug}`,
      httpMethod: result.httpMethod,
      transforms: this.buildTransforms(result),
      status: result.confidence >= 0.85 ? 'active' : 'pending_approval',
      createdAt: now(),
      updatedAt: now(),
      usageCount: 0,
      requiresApproval: result.confidence < 0.85,
    };

    return { contract, reasoning: result.reasoning };
  }

  private buildPrompt(
    intent: FrontendIntent,
    capabilities: BackendCapability[]
  ): string {
    const capSummaries = capabilities.map(cap => ({
      id: cap.id,
      name: cap.name,
      description: cap.description,
      tags: cap.tags,
      method: cap.method,
      input: Object.keys(cap.input || {}),
      output: Object.keys(cap.output || {}),
    }));

    return `You are AutoBridge, a system that wires frontend intents to backend capabilities.

FRONTEND INTENT (what the frontend needs):
${JSON.stringify({
  id: intent.id,
  name: intent.name,
  description: intent.description,
  tags: intent.tags,
  action: intent.action,
  requiredFields: intent.requiredFields,
  expectedShape: intent.expectedShape,
}, null, 2)}

AVAILABLE BACKEND CAPABILITIES:
${JSON.stringify(capSummaries, null, 2)}

Your task:
1. Find the best matching capability for this intent (or determine no match exists).
2. If matched, generate a clean endpoint slug (e.g. "users/list"), suggest the HTTP method, and write minimal JS transform functions if needed.
3. Be conservative — only match if you are reasonably confident. A confidence below 0.5 should be a non-match.

Respond ONLY with a JSON object (no markdown, no preamble):
{
  "matched": true | false,
  "capabilityId": "<id of matched capability or null>",
  "confidence": 0.0–1.0,
  "reasoning": "<clear explanation of why this matches or doesn't>",
  "httpMethod": "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  "endpointSlug": "<url-safe slug, e.g. users/list>",
  "requestTransform": "<optional JS arrow fn string: (intentParams) => backendParams, or null>",
  "responseTransform": "<optional JS arrow fn string: (backendOutput) => frontendShape, or null>"
}`;
  }

  private async callClaude(
    prompt: string,
    apiKey: string,
    model: string
  ): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const textBlock = data.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text content in LLM response');
    return textBlock.text;
  }

  private parseResponse(raw: string): LLMResolutionResult {
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim();
      return JSON.parse(cleaned) as LLMResolutionResult;
    } catch {
      return {
        matched: false,
        capabilityId: null,
        confidence: 0,
        reasoning: `Failed to parse LLM response: ${raw.slice(0, 200)}`,
        httpMethod: 'GET',
        endpointSlug: '',
      };
    }
  }

  private buildTransforms(result: LLMResolutionResult): ContractTransform | undefined {
    if (!result.requestTransform && !result.responseTransform) return undefined;
    return {
      request: result.requestTransform || undefined,
      response: result.responseTransform || undefined,
    };
  }
}
