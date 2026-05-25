/**
 * Proxy Layer
 * Intercepts incoming requests to /bridge/*, looks up the contract,
 * applies transforms, and forwards to the real backend.
 * This is what runs at runtime — zero re-resolution once a contract is active.
 */

import type { Contract } from '../manifest/types.js';
import type { ContractStore } from '../store/contract-store.js';
import type { BackendManifest } from '../manifest/types.js';

interface ProxyRequest {
  method: string;
  endpoint: string;  // e.g. /bridge/users/list
  headers: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  contract?: Contract;
  durationMs: number;
}

interface ProxyError {
  status: number;
  error: string;
  detail?: string;
}

export class ProxyLayer {
  constructor(
    private store: ContractStore,
    private getBackendManifests: () => BackendManifest[]
  ) {}

  async forward(req: ProxyRequest): Promise<ProxyResponse | ProxyError> {
    const start = Date.now();

    // Look up contract by endpoint
    const contract = this.store.getContractByEndpoint(req.endpoint);
    if (!contract) {
      return {
        status: 404,
        error: 'No contract found for this endpoint',
        detail: `Endpoint ${req.endpoint} has no active contract. Has the intent been resolved?`,
      };
    }

    if (contract.status === 'pending_approval') {
      return {
        status: 503,
        error: 'Contract pending approval',
        detail: 'This connection was synthesized by LLM and requires manual approval in the AutoBridge dashboard.',
      };
    }

    // Find the backend service
    const manifests = this.getBackendManifests();
    const manifest = manifests.find(m => m.serviceId === contract.serviceId);
    if (!manifest) {
      return {
        status: 502,
        error: 'Backend service not found',
        detail: `Service ${contract.serviceId} is not registered or has gone offline.`,
      };
    }

    // Find the capability to get the real handler path
    const capability = manifest.capabilities.find(c => c.id === contract.capabilityId);
    if (!capability) {
      return {
        status: 502,
        error: 'Capability not found in backend manifest',
      };
    }

    // Apply request transform if any
    let forwardBody = req.body;
    let forwardQuery = req.query;
    if (contract.transforms?.request) {
      try {
        const transformFn = new Function('params', `return (${contract.transforms.request})(params)`);
        const transformed = transformFn({ body: req.body, query: req.query });
        forwardBody = transformed.body ?? forwardBody;
        forwardQuery = transformed.query ?? forwardQuery;
      } catch (e) {
        console.warn('[AutoBridge] Request transform failed, using raw params:', e);
      }
    }

    // Build target URL
    const targetUrl = this.buildTargetUrl(manifest.baseUrl, capability.handler, forwardQuery);

    // Forward the request
    let backendResponse: Response;
    try {
      backendResponse = await fetch(targetUrl, {
        method: contract.httpMethod,
        headers: {
          'Content-Type': 'application/json',
          ...this.filterHeaders(req.headers),
        },
        body: ['GET', 'HEAD'].includes(contract.httpMethod)
          ? undefined
          : JSON.stringify(forwardBody),
      });
    } catch (err) {
      return {
        status: 502,
        error: 'Backend unreachable',
        detail: `Could not reach ${targetUrl}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    let responseBody: unknown;
    const contentType = backendResponse.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      responseBody = await backendResponse.json();
    } else {
      responseBody = await backendResponse.text();
    }

    // Apply response transform if any
    if (contract.transforms?.response && backendResponse.ok) {
      try {
        const transformFn = new Function('data', `return (${contract.transforms.response})(data)`);
        responseBody = transformFn(responseBody);
      } catch (e) {
        console.warn('[AutoBridge] Response transform failed, using raw response:', e);
      }
    }

    // Update usage stats (fire and forget)
    this.store.incrementUsage(contract.id);

    const durationMs = Date.now() - start;

    return {
      status: backendResponse.status,
      headers: {
        'Content-Type': 'application/json',
        'X-AutoBridge-Contract': contract.id,
        'X-AutoBridge-Source': contract.source,
        'X-AutoBridge-Duration': String(durationMs),
      },
      body: responseBody,
      contract,
      durationMs,
    };
  }

  private buildTargetUrl(
    baseUrl: string,
    handler: string,
    query?: Record<string, string>
  ): string {
    const base = baseUrl.replace(/\/$/, '');
    const path = handler.startsWith('/') ? handler : `/${handler}`;
    let url = `${base}${path}`;
    
    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }
    
    return url;
  }

  private filterHeaders(headers: Record<string, string>): Record<string, string> {
    // Pass through auth headers but strip AutoBridge-specific ones
    const filtered: Record<string, string> = {};
    const PASSTHROUGH = ['authorization', 'x-api-key', 'x-request-id', 'accept-language'];
    
    for (const [key, value] of Object.entries(headers)) {
      if (PASSTHROUGH.includes(key.toLowerCase())) {
        filtered[key] = value;
      }
    }
    return filtered;
  }
}
