/**
 * AutoBridge WebSocket Event Bus
 * Pushes real-time events to the dashboard (and any other subscribers).
 *
 * Events emitted:
 *   contract:resolved   — new contract created (convention or LLM)
 *   contract:approved   — pending contract approved
 *   contract:rejected   — contract rejected
 *   contract:drifted    — contract invalidated by drift detector
 *   backend:registered  — new backend service came online
 *   backend:offline     — backend missed heartbeat threshold
 *   frontend:registered — new frontend app registered
 *   drift:detected      — capability changed, contracts invalidated
 *   resolution:failed   — intent could not be resolved
 */

import type { FastifyInstance } from 'fastify';

export type EventType =
  | 'contract:resolved'
  | 'contract:approved'
  | 'contract:rejected'
  | 'contract:drifted'
  | 'backend:registered'
  | 'backend:offline'
  | 'frontend:registered'
  | 'drift:detected'
  | 'resolution:failed';

export interface BridgeEvent {
  type: EventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

interface SSEClient {
  id: string;
  reply: {
    raw: {
      write: (data: string) => void;
      end: () => void;
    };
  };
  connectedAt: string;
}

/**
 * EventBus — a lightweight Server-Sent Events (SSE) broadcaster.
 *
 * SSE is chosen over WebSockets because:
 * - The dashboard only needs server→client push (no bidirectional channel needed)
 * - SSE works through HTTP/2, proxies, and firewalls without extra negotiation
 * - Native browser EventSource API, no client-side library needed
 * - Automatic reconnection built into the protocol
 */
export class EventBus {
  private clients = new Map<string, SSEClient>();
  private eventHistory: BridgeEvent[] = [];
  private readonly HISTORY_LIMIT = 100;

  /**
   * Attach SSE route to the Fastify instance.
   * Dashboard connects to GET /events and receives a stream.
   */
  attach(app: FastifyInstance): void {
    // SSE endpoint — dashboard connects here
    app.get('/events', (req, reply) => {
      const clientId = `sse-${Math.random().toString(36).slice(2, 10)}`;

      // SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no', // disable nginx buffering
      });

      // Register client
      const client: SSEClient = {
        id: clientId,
        reply,
        connectedAt: new Date().toISOString(),
      };
      this.clients.set(clientId, client);

      // Send connection confirmation + recent history
      this.writeToClient(client, {
        type: 'contract:resolved', // reuse as "connected" signal
        timestamp: new Date().toISOString(),
        payload: {
          _meta: 'connected',
          clientId,
          recentEvents: this.eventHistory.slice(-20),
        },
      });

      // Keepalive ping every 15s (prevents proxy timeouts)
      const keepalive = setInterval(() => {
        try {
          reply.raw.write(': ping\n\n');
        } catch {
          clearInterval(keepalive);
          this.clients.delete(clientId);
        }
      }, 15_000);

      // Clean up on disconnect
      req.raw.on('close', () => {
        clearInterval(keepalive);
        this.clients.delete(clientId);
      });

      // Don't let Fastify close the response
      return reply;
    });

    // Stats endpoint — how many clients are connected
    app.get('/events/stats', () => ({
      connectedClients: this.clients.size,
      historySize: this.eventHistory.length,
      clients: Array.from(this.clients.values()).map(c => ({
        id: c.id,
        connectedAt: c.connectedAt,
      })),
    }));
  }

  /**
   * Emit an event to all connected dashboard clients.
   * Also records it in the rolling history buffer.
   */
  emit(type: EventType, payload: Record<string, unknown>): void {
    const event: BridgeEvent = {
      type,
      timestamp: new Date().toISOString(),
      payload,
    };

    // Rolling history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.HISTORY_LIMIT) {
      this.eventHistory.shift();
    }

    // Broadcast to all SSE clients
    const dead: string[] = [];
    for (const [id, client] of this.clients) {
      try {
        this.writeToClient(client, event);
      } catch {
        dead.push(id);
      }
    }

    // Clean up dead connections
    for (const id of dead) this.clients.delete(id);
  }

  private writeToClient(client: SSEClient, event: BridgeEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    client.reply.raw.write(data);
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
