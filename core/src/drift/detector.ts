/**
 * Drift Detector
 *
 * When a backend re-registers, this compares the new manifest against the
 * stored one. If capabilities have changed (added, removed, or schema-modified),
 * it marks dependent contracts as 'drifted' so they get re-resolved.
 *
 * Drift types detected:
 *   - capability_removed   → contracts depending on it marked drifted immediately
 *   - capability_added     → triggers re-resolution for unresolved intents
 *   - output_schema_changed → contracts marked drifted (shape may no longer match)
 *   - method_changed       → contracts marked drifted (HTTP method mismatch)
 *   - handler_changed      → contracts marked drifted (proxy would route wrong)
 */

import type { BackendManifest, BackendCapability, Contract } from '../manifest/types.js';
import type { ContractStore } from '../store/contract-store.js';
import type { EventBus } from '../events/event-bus.js';

export interface DriftReport {
  serviceId: string;
  checkedAt: string;
  removedCapabilities: string[];
  addedCapabilities: string[];
  modifiedCapabilities: string[];
  driftedContractIds: string[];
  hasChanges: boolean;
}

export class DriftDetector {
  constructor(
    private store: ContractStore,
    private eventBus: EventBus
  ) {}

  /**
   * Compare incoming manifest against the stored version.
   * Called every time a backend re-registers.
   */
  detect(
    incoming: BackendManifest,
    stored: BackendManifest | null
  ): DriftReport {
    const report: DriftReport = {
      serviceId: incoming.serviceId,
      checkedAt: new Date().toISOString(),
      removedCapabilities: [],
      addedCapabilities: [],
      modifiedCapabilities: [],
      driftedContractIds: [],
      hasChanges: false,
    };

    // First registration — nothing to compare
    if (!stored) return report;

    const storedById = new Map(stored.capabilities.map(c => [c.id, c]));
    const incomingById = new Map(incoming.capabilities.map(c => [c.id, c]));

    // ── Removed capabilities ─────────────────────────────────────────────────
    for (const [id, cap] of storedById) {
      if (!incomingById.has(id)) {
        report.removedCapabilities.push(id);
        // Immediately drift all contracts that depend on this capability
        const contracts = this.getContractsByCapability(id, incoming.serviceId);
        for (const contract of contracts) {
          this.store.updateContractStatus(contract.id, 'drifted');
          report.driftedContractIds.push(contract.id);
          this.eventBus.emit('contract:drifted', {
            contractId: contract.id,
            reason: 'capability_removed',
            capabilityId: id,
            capabilityName: cap.name,
            serviceId: incoming.serviceId,
          });
        }
      }
    }

    // ── Added capabilities ───────────────────────────────────────────────────
    for (const [id] of incomingById) {
      if (!storedById.has(id)) {
        report.addedCapabilities.push(id);
        // Added caps are handled by the resolver (re-resolves pending intents)
      }
    }

    // ── Modified capabilities ────────────────────────────────────────────────
    for (const [id, incomingCap] of incomingById) {
      const storedCap = storedById.get(id);
      if (!storedCap) continue;

      const changes = this.detectCapabilityChanges(storedCap, incomingCap);
      if (changes.length === 0) continue;

      report.modifiedCapabilities.push(id);

      // Only drift contracts if breaking changes occurred
      const hasBreakingChange = changes.some(c =>
        ['output_schema_changed', 'method_changed', 'handler_changed'].includes(c)
      );

      if (hasBreakingChange) {
        const contracts = this.getContractsByCapability(id, incoming.serviceId);
        for (const contract of contracts) {
          this.store.updateContractStatus(contract.id, 'drifted');
          report.driftedContractIds.push(contract.id);
          this.eventBus.emit('contract:drifted', {
            contractId: contract.id,
            reason: 'capability_modified',
            capabilityId: id,
            changes,
            serviceId: incoming.serviceId,
          });
        }
      }
    }

    report.hasChanges =
      report.removedCapabilities.length > 0 ||
      report.addedCapabilities.length > 0 ||
      report.modifiedCapabilities.length > 0;

    if (report.hasChanges) {
      this.eventBus.emit('drift:detected', {
        serviceId: incoming.serviceId,
        serviceName: incoming.serviceName,
        removed: report.removedCapabilities.length,
        added: report.addedCapabilities.length,
        modified: report.modifiedCapabilities.length,
        driftedContracts: report.driftedContractIds.length,
      });
    }

    return report;
  }

  /**
   * Periodic drift check — compares all stored manifests against
   * heartbeat timestamps. Services that haven't heartbeated in
   * `offlineThresholdMs` are considered offline and their contracts drifted.
   */
  checkOfflineServices(
    liveManifests: Map<string, BackendManifest>,
    offlineThresholdMs = 90_000
  ): string[] {
    const offlineServiceIds: string[] = [];
    const now = Date.now();

    for (const [serviceId, manifest] of liveManifests) {
      const lastHB = manifest.lastHeartbeat
        ? new Date(manifest.lastHeartbeat).getTime()
        : 0;

      if (now - lastHB > offlineThresholdMs) {
        offlineServiceIds.push(serviceId);

        // Drift all active contracts for this service
        const allContracts = this.store.getAllContracts({ status: 'active' });
        const affectedContracts = allContracts.filter(
          c => c.serviceId === serviceId
        );

        for (const contract of affectedContracts) {
          this.store.updateContractStatus(contract.id, 'drifted');
          this.eventBus.emit('contract:drifted', {
            contractId: contract.id,
            reason: 'service_offline',
            serviceId,
            serviceName: manifest.serviceName,
          });
        }

        this.eventBus.emit('backend:offline', {
          serviceId,
          serviceName: manifest.serviceName,
          lastHeartbeat: manifest.lastHeartbeat,
          affectedContracts: affectedContracts.length,
        });
      }
    }

    return offlineServiceIds;
  }

  private detectCapabilityChanges(
    stored: BackendCapability,
    incoming: BackendCapability
  ): string[] {
    const changes: string[] = [];

    if (stored.method !== incoming.method) {
      changes.push('method_changed');
    }

    if (stored.handler !== incoming.handler) {
      changes.push('handler_changed');
    }

    if (!this.schemasEqual(stored.output, incoming.output)) {
      changes.push('output_schema_changed');
    }

    if (!this.schemasEqual(stored.input ?? {}, incoming.input ?? {})) {
      changes.push('input_schema_changed'); // non-breaking but notable
    }

    if (stored.name !== incoming.name) {
      changes.push('name_changed'); // non-breaking
    }

    return changes;
  }

  private schemasEqual(
    a: Record<string, unknown>,
    b: Record<string, unknown>
  ): boolean {
    // Deep equality via JSON serialization (sufficient for schema comparison)
    return JSON.stringify(this.sortKeys(a)) === JSON.stringify(this.sortKeys(b));
  }

  private sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
    if (typeof obj !== 'object' || obj === null) return obj;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const val = obj[key];
      sorted[key] = typeof val === 'object' && val !== null
        ? this.sortKeys(val as Record<string, unknown>)
        : val;
    }
    return sorted;
  }

  private getContractsByCapability(
    capabilityId: string,
    serviceId: string
  ): Contract[] {
    return this.store.getAllContracts({ status: 'active' }).filter(
      c => c.capabilityId === capabilityId && c.serviceId === serviceId
    );
  }
}
