/**
 * AutoBridge Core Server
 * The central HTTP server that:
 * 1. Accepts manifest registrations from SDKs
 * 2. Resolves intents → contracts (convention first, LLM fallback)
 * 3. Proxies /bridge/* requests to the correct backend
 * 4. Serves the management API for the dashboard
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ContractStore } from './store/contract-store.js';
import { ConventionResolver } from './resolver/convention.js';
import { LLMSynthesizer } from './synthesizer/llm.js';
import { ProxyLayer } from './proxy/proxy.js';
import { EventBus } from './events/event-bus.js';
import { DriftDetector } from './drift/detector.js';
import { validateKeyFormat, generateBridgeToken, mask } from './security/crypto.js';
import { generateId, now } from './utils.js';
import type {
  BackendManifest,
  FrontendManifest,
  Contract,
} from './manifest/types.js';

interface BridgeConfig {
  port?: number;
  dbPath?: string;
  llmApiKey?: string;
  llmModel?: string;
  autoApprove?: boolean;        // auto-approve high-confidence LLM contracts
  autoApproveThreshold?: number; // default 0.85
  adminToken?: string;
}

export async function createBridgeServer(config: BridgeConfig = {}) {
  const {
    port = 7331,
    dbPath,
    llmApiKey: configApiKey,
    llmModel = 'claude-sonnet-4-20250514',
    autoApprove = true,
    autoApproveThreshold = 0.85,
  } = config;

  console.log('[AutoBridge] Initializing server...');

  // ─── CORE SERVICES ─────────────────────────────────────────────────────────
  console.log('[AutoBridge] Creating contract store...');
  const store = new ContractStore(dbPath);
  console.log('[AutoBridge] Initializing database...');
  await store.init();           // sql.js requires async WASM init
  console.log('[AutoBridge] Database initialized');
  const conventionResolver = new ConventionResolver();
  const llmSynthesizer = new LLMSynthesizer();
  const eventBus = new EventBus();

  // In-memory caches (source of truth is the DB)
  const backendManifests = new Map<string, BackendManifest>();
  const frontendManifests = new Map<string, FrontendManifest>();

  // Rehydrate from DB on startup
  for (const m of store.getAllBackendManifests()) backendManifests.set(m.serviceId, m);
  for (const m of store.getAllFrontendManifests()) frontendManifests.set(m.appId, m);

  const proxy = new ProxyLayer(store, () => Array.from(backendManifests.values()));

  // ─── FASTIFY SETUP ─────────────────────────────────────────────────────────
  const app = Fastify({ logger: { level: 'info' } });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Attach SSE event stream (must come before route registration)
  eventBus.attach(app);

  // Drift detector — needs eventBus + store
  const driftDetector = new DriftDetector(store, eventBus);

  // Offline service check — runs every 60s
  setInterval(() => {
    const offline = driftDetector.checkOfflineServices(backendManifests);
    for (const sid of offline) {
      app.log.warn(`[AutoBridge] Service ${sid} appears offline — contracts drifted`);
    }
  }, 60_000);

  // ─── HEALTH CHECK ──────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    backends: backendManifests.size,
    frontends: frontendManifests.size,
    contracts: store.getAllContracts().length,
    timestamp: now(),
  }));

  // ─── MANIFEST REGISTRATION ─────────────────────────────────────────────────

  app.post<{ Body: { manifest: BackendManifest; apiKey?: string } }>(
    '/registry/backend',
    async (req, reply) => {
      const { manifest } = req.body;
      if (!manifest?.serviceId || !manifest?.capabilities?.length) {
        return reply.status(400).send({ error: 'Invalid backend manifest' });
      }

      manifest.registeredAt = manifest.registeredAt || now();
      manifest.lastHeartbeat = now();

      // Drift detection — compare against previously stored manifest
      const previousManifest = store.getAllBackendManifests()
        .find(m => m.serviceId === manifest.serviceId) ?? null;
      const driftReport = driftDetector.detect(manifest, previousManifest);

      backendManifests.set(manifest.serviceId, manifest);
      store.saveBackendManifest(manifest);

      app.log.info(`[AutoBridge] Backend registered: ${manifest.serviceName} (${manifest.capabilities.length} capabilities)`);

      eventBus.emit('backend:registered', {
        serviceId: manifest.serviceId,
        serviceName: manifest.serviceName,
        capabilities: manifest.capabilities.length,
        drift: driftReport.hasChanges ? driftReport : null,
      });

      // Trigger re-resolution for any pending intents that might now match
      await resolveAllPendingIntents(req.body.apiKey);

      return {
        status: 'registered',
        serviceId: manifest.serviceId,
        capabilitiesIndexed: manifest.capabilities.length,
      };
    }
  );

  app.post<{ Body: { manifest: FrontendManifest; apiKey?: string } }>(
    '/registry/frontend',
    async (req, reply) => {
      const { manifest } = req.body;
      if (!manifest?.appId || !manifest?.intents?.length) {
        return reply.status(400).send({ error: 'Invalid frontend manifest' });
      }

      manifest.registeredAt = manifest.registeredAt || now();
      frontendManifests.set(manifest.appId, manifest);
      store.saveFrontendManifest(manifest);

      app.log.info(`[AutoBridge] Frontend registered: ${manifest.appName} (${manifest.intents.length} intents)`);

      // Resolve intents immediately
      const resolved = await resolveForApp(manifest.appId, req.body.apiKey);

      eventBus.emit('frontend:registered', {
        appId: manifest.appId,
        appName: manifest.appName,
        intents: manifest.intents.length,
        resolved: resolved.resolved,
        pending: resolved.pending,
      });

      return {
        status: 'registered',
        appId: manifest.appId,
        intentsRegistered: manifest.intents.length,
        contractsResolved: resolved.resolved,
        contractsPending: resolved.pending,
      };
    }
  );

  // Heartbeat — keeps backends alive in the registry
  app.post<{ Body: { serviceId?: string; appId?: string } }>(
    '/registry/heartbeat',
    async (req) => {
      if (req.body.serviceId) {
        store.updateHeartbeat(req.body.serviceId);
        const m = backendManifests.get(req.body.serviceId);
        if (m) m.lastHeartbeat = now();
      }
      return { status: 'ok', timestamp: now() };
    }
  );

  // ─── INTENT RESOLUTION ─────────────────────────────────────────────────────

  app.post<{
    Body: { intentId: string; appId: string; forceReresolve?: boolean; llmApiKey?: string };
  }>('/resolve', async (req, reply) => {
    const { intentId, appId, forceReresolve, llmApiKey: requestApiKey } = req.body;

    if (!forceReresolve) {
      const existing = store.getContractByIntent(intentId, appId);
      if (existing) return { contract: existing, status: 'cached' };
    }

    const result = await resolveIntent(intentId, appId, requestApiKey);
    if (!result) {
      return reply.status(404).send({
        contract: null,
        status: 'failed',
        message: 'No backend capability found for this intent.',
      });
    }

    return { contract: result.contract, status: result.status };
  });

  // ─── PROXY ─────────────────────────────────────────────────────────────────
  // All /bridge/* requests are forwarded to backends

  const PROXY_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
  for (const method of PROXY_METHODS) {
    app.route({
      method,
      url: '/bridge/*',
      handler: async (req, reply) => {
        const result = await proxy.forward({
          method: req.method,
          endpoint: req.url.split('?')[0],
          headers: req.headers as Record<string, string>,
          body: req.body,
          query: req.query as Record<string, string>,
        });

        if ('error' in result) {
          return reply.status(result.status).send({ error: result.error, detail: result.detail });
        }

        reply.status(result.status);
        for (const [k, v] of Object.entries(result.headers)) reply.header(k, v);
        return result.body;
      },
    });
  }

  // ─── MANAGEMENT API (for Dashboard) ────────────────────────────────────────

  app.get('/admin/contracts', async (req) => {
    const query = req.query as Record<string, string>;
    return store.getAllContracts({
      status: query.status as Contract['status'],
      appId: query.appId,
    });
  });

  app.patch<{ Params: { id: string }; Body: { status: string; approvedBy?: string } }>(
    '/admin/contracts/:id',
    async (req, reply) => {
      const { id } = req.params;
      const { status, approvedBy } = req.body;
      const allowed = ['active', 'rejected', 'deprecated'];
      if (!allowed.includes(status)) {
        return reply.status(400).send({ error: `Status must be one of: ${allowed.join(', ')}` });
      }
      store.updateContractStatus(id, status as Contract['status'], approvedBy);

      const eventType = status === 'active' ? 'contract:approved' : 'contract:rejected';
      eventBus.emit(eventType, { contractId: id, status, approvedBy });

      return { success: true };
    }
  );

  app.get('/admin/backends', async () => {
    return Array.from(backendManifests.values());
  });

  app.get('/admin/frontends', async () => {
    return Array.from(frontendManifests.values());
  });

  // API Key management
  app.post<{ Body: { apiKey: string; provider?: string } }>(
    '/admin/keys',
    async (req, reply) => {
      const { apiKey, provider = 'anthropic' } = req.body;
      if (!validateKeyFormat(apiKey)) {
        return reply.status(400).send({ error: 'Invalid API key format' });
      }
      const id = store.saveApiKey(apiKey, provider);
      return { id, preview: mask(apiKey), provider };
    }
  );

  app.get('/admin/keys', async () => {
    return store.listApiKeyPreviews();
  });

  app.delete<{ Params: { id: string } }>('/admin/keys/:id', async (req) => {
    store.deleteApiKey(req.params.id);
    return { success: true };
  });

  // ─── RESOLUTION HELPERS ────────────────────────────────────────────────────

  async function resolveIntent(
    intentId: string,
    appId: string,
    requestApiKey?: string
  ): Promise<{ contract: Contract; status: string } | null> {
    const app_manifest = frontendManifests.get(appId);
    if (!app_manifest) return null;

    const intent = app_manifest.intents.find(i => i.id === intentId);
    if (!intent) return null;

    const allCapabilities = Array.from(backendManifests.values())
      .flatMap(m => m.capabilities.map(c => ({ ...c, _serviceId: m.serviceId })));

    if (allCapabilities.length === 0) return null;

    const start = Date.now();

    // 1. Convention pass
    const conventionMatch = conventionResolver.resolve(intent, allCapabilities);
    if (conventionMatch) {
      const serviceId = (conventionMatch.capability as BackendCapability & { _serviceId: string })._serviceId;
      const contract = conventionResolver.buildContract(conventionMatch, intent, appId, serviceId);
      store.saveContract(contract);
      store.logResolution({
        id: generateId(),
        intentId,
        appId,
        source: 'convention',
        confidence: contract.confidence,
        success: true,
        durationMs: Date.now() - start,
      });
      eventBus.emit('contract:resolved', {
        contractId: contract.id,
        source: 'convention',
        intentId,
        appId,
        endpoint: contract.generatedEndpoint,
        confidence: contract.confidence,
      });
      return { contract, status: 'resolved_convention' };
    }

    // 2. LLM pass
    const apiKey = requestApiKey
      || configApiKey
      || process.env.AUTOBRIDGE_ANTHROPIC_KEY
      || process.env.ANTHROPIC_API_KEY
      || store.getProjectApiKey()
      || undefined;

    if (!apiKey) {
      app.log.warn(`[AutoBridge] No API key available for LLM synthesis — intent ${intentId} unresolved`);
      return null;
    }

    const { contract: llmContract, reasoning } = await llmSynthesizer.resolve(
      intent,
      allCapabilities,
      { apiKey, model: llmModel }
    );

    if (!llmContract) {
      store.logResolution({
        id: generateId(), intentId, appId, source: 'llm',
        success: false, durationMs: Date.now() - start, error: reasoning,
      });
      eventBus.emit('resolution:failed', { intentId, appId, reason: reasoning });
      return null;
    }

    // Fill in appId/serviceId (LLM doesn't know these)
    const serviceId = (allCapabilities.find(c => c.id === llmContract.capabilityId) as BackendCapability & { _serviceId: string })?._serviceId;
    llmContract.appId = appId;
    llmContract.serviceId = serviceId || '__unknown__';

    if (autoApprove && llmContract.confidence >= autoApproveThreshold) {
      llmContract.status = 'active';
      llmContract.requiresApproval = false;
    }

    store.saveContract(llmContract);
    store.logResolution({
      id: generateId(), intentId, appId, source: 'llm',
      confidence: llmContract.confidence, success: true, durationMs: Date.now() - start,
    });
    eventBus.emit('contract:resolved', {
      contractId: llmContract.id,
      source: 'llm',
      intentId,
      appId,
      endpoint: llmContract.generatedEndpoint,
      confidence: llmContract.confidence,
      pendingApproval: llmContract.requiresApproval,
    });

    return {
      contract: llmContract,
      status: llmContract.status === 'active' ? 'resolved_llm' : 'pending_approval',
    };
  }

  type BackendCapability = import('./manifest/types.js').BackendCapability;

  async function resolveForApp(appId: string, apiKey?: string) {
    const manifest = frontendManifests.get(appId);
    if (!manifest) return { resolved: 0, pending: 0 };

    let resolved = 0;
    let pending = 0;

    for (const intent of manifest.intents) {
      const existing = store.getContractByIntent(intent.id, appId);
      if (existing?.status === 'active') { resolved++; continue; }

      const result = await resolveIntent(intent.id, appId, apiKey);
      if (result?.contract.status === 'active') resolved++;
      else if (result?.contract.status === 'pending_approval') pending++;
    }

    return { resolved, pending };
  }

  async function resolveAllPendingIntents(apiKey?: string) {
    for (const [appId] of frontendManifests) {
      await resolveForApp(appId, apiKey);
    }
  }

  // ─── START ──────────────────────────────────────────────────────────────────

  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`🌉 AutoBridge running on http://localhost:${port}`);

  return { app, store };
}

// ─── MAIN EXECUTION ────────────────────────────────────────────────────────
// Auto-start the server when this file is run directly
const config = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 7331,
  dbPath: process.env.DB_PATH || '.autobridge/bridge.db',
  llmApiKey: process.env.ANTHROPIC_API_KEY,
  llmModel: 'claude-sonnet-4-20250514',
  autoApprove: true,
  autoApproveThreshold: 0.85,
};

createBridgeServer(config).catch((err) => {
  console.error('Failed to start AutoBridge server:', err);
  process.exit(1);
});
