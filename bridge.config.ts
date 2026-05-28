/**
 * WireBridge Project Configuration
 * Place this in your project root.
 */

import type { BridgeConfig } from '@wirebridge/core';

const config: BridgeConfig = {
  // Bridge server port
  port: 7331,

  // SQLite DB path (relative to project root)
  // For production, use a PostgreSQL connection string instead
  dbPath: '.wirebridge/bridge.db',

  // Claude API key for LLM synthesis
  // Priority: request-level > this > WIREBRIDGE_ANTHROPIC_KEY env var > dashboard key
  llmApiKey: process.env.ANTHROPIC_API_KEY,

  // Claude model to use for synthesis
  llmModel: 'claude-sonnet-4-20250514',

  // Auto-approve LLM-synthesized contracts above this confidence threshold
  // Set to 1.0 to require manual approval for all LLM contracts
  autoApprove: true,
  autoApproveThreshold: 0.85,
};

export default config;
