/**
 * AutoBridge TypeScript SDK
 * For both Node.js backends (Express, Fastify, etc.)
 * and frontend frameworks (React, Vue, Svelte, Next.js).
 */

import type {
  BackendManifest,
  BackendCapability,
  FrontendManifest,
  FrontendIntent,
  Contract,
  FieldSchema,
} from './types.js';

export type { BackendManifest, BackendCapability, FrontendManifest, FrontendIntent, Contract, FieldSchema };

// ─── SCHEMA HELPERS ──────────────────────────────────────────────────────────

export const s = {
  string: (opts: Partial<FieldSchema> = {}): FieldSchema => ({ type: 'string', ...opts }),
  number: (opts: Partial<FieldSchema> = {}): FieldSchema => ({ type: 'number', ...opts }),
  boolean: (opts: Partial<FieldSchema> = {}): FieldSchema => ({ type: 'boolean', ...opts }),
  object: (properties: Record<string, FieldSchema>, opts: Partial<FieldSchema> = {}): FieldSchema =>
    ({ type: 'object', properties, ...opts }),
  array: (items: FieldSchema, opts: Partial<FieldSchema> = {}): FieldSchema =>
    ({ type: 'array', items, ...opts }),
  any: (): FieldSchema => ({ type: 'any' }),
};

// ─── BACKEND CLIENT ───────────────────────────────────────────────────────────

export interface BackendBridgeConfig {
  bridgeUrl?: string;
  serviceId?: string;
  serviceName: string;
  version?: string;
  baseUrl: string;
  stack?: string;
  apiKey?: string;
  heartbeatInterval?: number;
  autoRegister?: boolean;
}

export class BackendBridge {
  private capabilities: (BackendCapability & { _handler?: unknown })[] = [];
  private registered = false;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private config: Required<BackendBridgeConfig>;

  constructor(config: BackendBridgeConfig) {
    this.config = {
      bridgeUrl: 'http://localhost:7331',
      serviceId: `svc-${Math.random().toString(36).slice(2, 10)}`,
      version: '1.0.0',
      stack: 'node',
      apiKey: '',
      heartbeatInterval: 30000,
      autoRegister: true,
      ...config,
    };
  }

  /**
   * Register a backend capability.
   * 
   * @example
   * bridge.capability({
   *   name: 'list users',
   *   handler: '/api/users',
   *   method: 'GET',
   *   output: { users: s.array(s.object({ name: s.string(), email: s.string() })) },
   *   tags: ['users', 'read'],
   * })
   */
  capability(cap: Omit<BackendCapability, 'id' | 'stack'> & { id?: string }): this {
    const id = cap.id || `${this.config.serviceId}.${cap.handler.replace(/\//g, '-')}`;
    this.capabilities.push({
      ...cap,
      id,
      stack: this.config.stack,
    });
    return this;
  }

  /**
   * Wrap a route handler and auto-register it as a capability.
   * Works with Express, Fastify, etc.
   */
  route<T extends (...args: unknown[]) => unknown>(
    capDef: Omit<BackendCapability, 'id' | 'stack'>,
    handler: T
  ): T {
    this.capability(capDef);
    return handler;
  }

  async register(apiKey?: string): Promise<boolean> {
    const key = apiKey || this.config.apiKey;
    const manifest = this.buildManifest();

    try {
      const res = await fetch(`${this.config.bridgeUrl}/registry/backend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest, apiKey: key || undefined }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.registered = true;
      this.startHeartbeat();
      console.log(`[AutoBridge] ✓ Registered ${this.capabilities.length} capabilities`);
      return true;
    } catch (err) {
      console.error(`[AutoBridge] Registration failed:`, err);
      return false;
    }
  }

  private buildManifest(): BackendManifest {
    return {
      serviceId: this.config.serviceId,
      serviceName: this.config.serviceName,
      version: this.config.version,
      baseUrl: this.config.baseUrl,
      stack: this.config.stack,
      capabilities: this.capabilities.map(({ ...c }) => c),
      registeredAt: new Date().toISOString(),
    };
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(async () => {
      try {
        await fetch(`${this.config.bridgeUrl}/registry/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceId: this.config.serviceId }),
        });
      } catch { /* silent */ }
    }, this.config.heartbeatInterval);
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }
}

// ─── FRONTEND CLIENT ──────────────────────────────────────────────────────────

export interface FrontendBridgeConfig {
  bridgeUrl?: string;
  appId?: string;
  appName: string;
  version?: string;
  framework?: string;
  apiKey?: string;
}

export interface UseIntentOptions {
  requiredFields?: string[];
  expectedShape?: Record<string, FieldSchema>;
  tags?: string[];
  action?: FrontendIntent['action'];
  llmApiKey?: string;
}

export class FrontendBridge {
  private intents: FrontendIntent[] = [];
  private contracts = new Map<string, Contract>();
  private registered = false;
  private config: Required<FrontendBridgeConfig>;

  constructor(config: FrontendBridgeConfig) {
    this.config = {
      bridgeUrl: 'http://localhost:7331',
      appId: `app-${Math.random().toString(36).slice(2, 10)}`,
      version: '1.0.0',
      framework: 'unknown',
      apiKey: '',
      ...config,
    };
  }

  /**
   * Declare an intent — what this frontend needs.
   * Returns the generated endpoint once resolved.
   *
   * @example
   * const endpoint = bridge.intent('list users with name and email', {
   *   requiredFields: ['name', 'email'],
   *   action: 'read',
   * })
   * // Use endpoint in your fetch calls
   * const users = await fetch(endpoint).then(r => r.json())
   */
  intent(name: string, options: UseIntentOptions = {}): string {
    const id = `intent-${name.toLowerCase().replace(/\s+/g, '-')}-${this.config.appId}`;

    if (!this.intents.find(i => i.id === id)) {
      this.intents.push({
        id,
        name,
        tags: options.tags,
        action: options.action,
        requiredFields: options.requiredFields,
        expectedShape: options.expectedShape,
        framework: this.config.framework,
      });
    }

    // Check if already resolved
    const contract = this.contracts.get(id);
    if (contract?.status === 'active') {
      return `${this.config.bridgeUrl}${contract.generatedEndpoint}`;
    }

    // Return a lazy proxy URL — will work once resolved
    return `${this.config.bridgeUrl}/bridge/__pending__/${id}`;
  }

  /**
   * Register all declared intents with the bridge.
   * Call this once on app startup.
   */
  async register(apiKey?: string): Promise<{
    resolved: number;
    pending: number;
    endpoints: Record<string, string>;
  }> {
    const key = apiKey || this.config.apiKey;
    const manifest: FrontendManifest = {
      appId: this.config.appId,
      appName: this.config.appName,
      version: this.config.version,
      framework: this.config.framework,
      intents: this.intents,
      registeredAt: new Date().toISOString(),
    };

    try {
      const res = await fetch(`${this.config.bridgeUrl}/registry/frontend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest, apiKey: key || undefined }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json() as {
        contractsResolved: number;
        contractsPending: number;
      };

      // Fetch resolved contracts
      await this.refreshContracts();

      const endpoints: Record<string, string> = {};
      for (const intent of this.intents) {
        const contract = this.contracts.get(intent.id);
        if (contract?.status === 'active') {
          endpoints[intent.name] = `${this.config.bridgeUrl}${contract.generatedEndpoint}`;
        }
      }

      this.registered = true;
      console.log(`[AutoBridge] ✓ ${data.contractsResolved} intents resolved, ${data.contractsPending} pending`);

      return {
        resolved: data.contractsResolved,
        pending: data.contractsPending,
        endpoints,
      };
    } catch (err) {
      console.error(`[AutoBridge] Frontend registration failed:`, err);
      return { resolved: 0, pending: 0, endpoints: {} };
    }
  }

  /**
   * Fetch all contracts for this app from the bridge.
   */
  async refreshContracts(): Promise<void> {
    try {
      const res = await fetch(
        `${this.config.bridgeUrl}/admin/contracts?appId=${this.config.appId}`
      );
      if (!res.ok) return;
      const contracts = await res.json() as Contract[];
      for (const c of contracts) {
        this.contracts.set(c.intentId, c);
      }
    } catch { /* silent */ }
  }

  /**
   * Get the resolved endpoint for an intent by name.
   * Returns null if not yet resolved.
   */
  getEndpoint(intentName: string): string | null {
    const id = `intent-${intentName.toLowerCase().replace(/\s+/g, '-')}-${this.config.appId}`;
    const contract = this.contracts.get(id);
    if (!contract || contract.status !== 'active') return null;
    return `${this.config.bridgeUrl}${contract.generatedEndpoint}`;
  }

  /**
   * Make a bridged fetch call by intent name.
   * Handles resolution automatically.
   */
  async fetch(intentName: string, init?: RequestInit): Promise<Response> {
    const endpoint = this.getEndpoint(intentName);
    if (!endpoint) {
      throw new Error(
        `[AutoBridge] Intent "${intentName}" is not yet resolved. ` +
        `Call bridge.register() first or check the dashboard for pending approvals.`
      );
    }
    return fetch(endpoint, init);
  }
}

// ─── REACT HOOK ───────────────────────────────────────────────────────────────
// Only available when React is present

export function createUseBridge(bridge: FrontendBridge) {
  return function useBridge<T = unknown>(
    intentName: string,
    options: UseIntentOptions & { fetchOnMount?: boolean } = {}
  ): {
    data: T | null;
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
    endpoint: string | null;
  } {
    // This is a factory — the actual hook is created at runtime
    // to avoid a hard React dependency in the SDK
    throw new Error(
      'useBridge must be used inside a React component. ' +
      'Import from @autobridge/react instead.'
    );
  };
}
