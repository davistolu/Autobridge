/**
 * Contract Store — sql.js backed (pure JS, no native binaries)
 * In production, swap to better-sqlite3 or a PostgreSQL adapter.
 */

import initSqlJs, { type Database } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { encrypt, decrypt, mask } from '../security/crypto.js';
import type {
  Contract,
  BackendManifest,
  FrontendManifest,
  ContractStatus,
} from '../manifest/types.js';
import { now } from '../utils.js';
import crypto from 'crypto';

export class ContractStore {
  private db!: Database;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), '.wirebridge', 'bridge.db');
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const SQL = await initSqlJs();
    
    if (fs.existsSync(this.dbPath)) {
      const data = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(data);
    } else {
      this.db = new SQL.Database();
    }
    
    this.migrate();
    this.initialized = true;
  }

  private save(): void {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  private run(sql: string, params: unknown[] = []): void {
    this.db.run(sql, params as (string | number | null | Uint8Array)[]);
    this.save();
  }

  private query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as (string | number | null | Uint8Array)[]);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        service_id TEXT NOT NULL,
        source TEXT NOT NULL,
        confidence REAL NOT NULL,
        reasoning TEXT,
        generated_endpoint TEXT NOT NULL,
        http_method TEXT NOT NULL,
        transform_request TEXT,
        transform_response TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        requires_approval INTEGER NOT NULL DEFAULT 0,
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used TEXT,
        usage_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS backend_manifests (
        service_id TEXT PRIMARY KEY,
        service_name TEXT NOT NULL,
        version TEXT NOT NULL,
        base_url TEXT NOT NULL,
        stack TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        last_heartbeat TEXT
      );
      CREATE TABLE IF NOT EXISTS frontend_manifests (
        app_id TEXT PRIMARY KEY,
        app_name TEXT NOT NULL,
        version TEXT NOT NULL,
        framework TEXT NOT NULL,
        intents_json TEXT NOT NULL,
        registered_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'anthropic',
        key_encrypted TEXT NOT NULL,
        key_preview TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used TEXT
      );
      CREATE TABLE IF NOT EXISTS resolution_log (
        id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        source TEXT NOT NULL,
        confidence REAL,
        success INTEGER NOT NULL,
        duration_ms INTEGER,
        error TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.save();
  }

  // ─── CONTRACTS ─────────────────────────────────────────────────────────────

  saveContract(contract: Contract): void {
    this.run(`
      INSERT OR REPLACE INTO contracts (
        id, intent_id, capability_id, app_id, service_id,
        source, confidence, reasoning, generated_endpoint, http_method,
        transform_request, transform_response, status,
        requires_approval, approved_by, approved_at,
        created_at, updated_at, last_used, usage_count
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      contract.id, contract.intentId, contract.capabilityId,
      contract.appId, contract.serviceId, contract.source,
      contract.confidence, contract.reasoning ?? null,
      contract.generatedEndpoint, contract.httpMethod,
      contract.transforms?.request ?? null,
      contract.transforms?.response ?? null,
      contract.status, contract.requiresApproval ? 1 : 0,
      contract.approvedBy ?? null, contract.approvedAt ?? null,
      contract.createdAt, contract.updatedAt,
      contract.lastUsed ?? null, contract.usageCount,
    ]);
  }

  getContractByIntent(intentId: string, appId: string): Contract | null {
    const rows = this.query<Record<string, unknown>>(
      `SELECT * FROM contracts WHERE intent_id=? AND app_id=? AND status='active' ORDER BY confidence DESC LIMIT 1`,
      [intentId, appId]
    );
    return rows[0] ? this.rowToContract(rows[0]) : null;
  }

  getContractByEndpoint(endpoint: string): Contract | null {
    const rows = this.query<Record<string, unknown>>(
      `SELECT * FROM contracts WHERE generated_endpoint=? AND status='active'`,
      [endpoint]
    );
    return rows[0] ? this.rowToContract(rows[0]) : null;
  }

  getAllContracts(filters?: { status?: ContractStatus; appId?: string }): Contract[] {
    let sql = 'SELECT * FROM contracts WHERE 1=1';
    const params: unknown[] = [];
    if (filters?.status) { sql += ' AND status=?'; params.push(filters.status); }
    if (filters?.appId) { sql += ' AND app_id=?'; params.push(filters.appId); }
    sql += ' ORDER BY updated_at DESC';
    return this.query<Record<string, unknown>>(sql, params).map(r => this.rowToContract(r));
  }

  updateContractStatus(id: string, status: ContractStatus, approvedBy?: string): void {
    this.run(
      `UPDATE contracts SET status=?, approved_by=?, approved_at=?, updated_at=? WHERE id=?`,
      [status, approvedBy ?? null, approvedBy ? now() : null, now(), id]
    );
  }

  incrementUsage(contractId: string): void {
    this.run(
      `UPDATE contracts SET usage_count=usage_count+1, last_used=? WHERE id=?`,
      [now(), contractId]
    );
  }

  private rowToContract(row: Record<string, unknown>): Contract {
    return {
      id: row['id'] as string,
      intentId: row['intent_id'] as string,
      capabilityId: row['capability_id'] as string,
      appId: row['app_id'] as string,
      serviceId: row['service_id'] as string,
      source: row['source'] as Contract['source'],
      confidence: row['confidence'] as number,
      reasoning: row['reasoning'] as string | undefined,
      generatedEndpoint: row['generated_endpoint'] as string,
      httpMethod: row['http_method'] as Contract['httpMethod'],
      transforms: (row['transform_request'] || row['transform_response']) ? {
        request: row['transform_request'] as string | undefined,
        response: row['transform_response'] as string | undefined,
      } : undefined,
      status: row['status'] as ContractStatus,
      requiresApproval: Boolean(row['requires_approval']),
      approvedBy: row['approved_by'] as string | undefined,
      approvedAt: row['approved_at'] as string | undefined,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
      lastUsed: row['last_used'] as string | undefined,
      usageCount: row['usage_count'] as number,
    };
  }

  // ─── MANIFESTS ─────────────────────────────────────────────────────────────

  saveBackendManifest(manifest: BackendManifest): void {
    this.run(`
      INSERT OR REPLACE INTO backend_manifests
      (service_id,service_name,version,base_url,stack,capabilities_json,registered_at,last_heartbeat)
      VALUES (?,?,?,?,?,?,?,?)
    `, [
      manifest.serviceId, manifest.serviceName, manifest.version,
      manifest.baseUrl, manifest.stack,
      JSON.stringify(manifest.capabilities),
      manifest.registeredAt, manifest.lastHeartbeat ?? now(),
    ]);
  }

  saveFrontendManifest(manifest: FrontendManifest): void {
    this.run(`
      INSERT OR REPLACE INTO frontend_manifests
      (app_id,app_name,version,framework,intents_json,registered_at)
      VALUES (?,?,?,?,?,?)
    `, [
      manifest.appId, manifest.appName, manifest.version,
      manifest.framework, JSON.stringify(manifest.intents), manifest.registeredAt,
    ]);
  }

  getAllBackendManifests(): BackendManifest[] {
    return this.query<Record<string, unknown>>('SELECT * FROM backend_manifests').map(r => ({
      serviceId: r['service_id'] as string,
      serviceName: r['service_name'] as string,
      version: r['version'] as string,
      baseUrl: r['base_url'] as string,
      stack: r['stack'] as string,
      capabilities: JSON.parse(r['capabilities_json'] as string),
      registeredAt: r['registered_at'] as string,
      lastHeartbeat: r['last_heartbeat'] as string | undefined,
    }));
  }

  getAllFrontendManifests(): FrontendManifest[] {
    return this.query<Record<string, unknown>>('SELECT * FROM frontend_manifests').map(r => ({
      appId: r['app_id'] as string,
      appName: r['app_name'] as string,
      version: r['version'] as string,
      framework: r['framework'] as string,
      intents: JSON.parse(r['intents_json'] as string),
      registeredAt: r['registered_at'] as string,
    }));
  }

  updateHeartbeat(serviceId: string): void {
    this.run('UPDATE backend_manifests SET last_heartbeat=? WHERE service_id=?', [now(), serviceId]);
  }

  // ─── API KEYS ──────────────────────────────────────────────────────────────

  saveApiKey(key: string, provider = 'anthropic'): string {
    const { encrypted, id } = encrypt(key);
    const preview = mask(key);
    this.run(
      `INSERT INTO api_keys (id,scope,provider,key_encrypted,key_preview,created_at) VALUES (?,?,?,?,?,?)`,
      [id, 'project', provider, encrypted, preview, now()]
    );
    return id;
  }

  getApiKey(id: string): string | null {
    const rows = this.query<{ key_encrypted: string }>('SELECT key_encrypted FROM api_keys WHERE id=?', [id]);
    if (!rows[0]) return null;
    this.run('UPDATE api_keys SET last_used=? WHERE id=?', [now(), id]);
    return decrypt(rows[0].key_encrypted, id);
  }

  getProjectApiKey(): string | null {
    const rows = this.query<{ id: string; key_encrypted: string }>(
      "SELECT id,key_encrypted FROM api_keys WHERE scope='project' ORDER BY created_at DESC LIMIT 1"
    );
    if (!rows[0]) return null;
    return decrypt(rows[0].key_encrypted, rows[0].id);
  }

  listApiKeyPreviews(): { id: string; preview: string; provider: string; createdAt: string }[] {
    return this.query<{ id: string; key_preview: string; provider: string; created_at: string }>(
      'SELECT id,key_preview,provider,created_at FROM api_keys ORDER BY created_at DESC'
    ).map(r => ({ id: r.id, preview: r.key_preview, provider: r.provider, createdAt: r.created_at }));
  }

  deleteApiKey(id: string): void {
    this.run('DELETE FROM api_keys WHERE id=?', [id]);
  }

  logResolution(entry: {
    id: string; intentId: string; appId: string; source: string;
    confidence?: number; success: boolean; durationMs?: number; error?: string;
  }): void {
    this.run(`
      INSERT INTO resolution_log (id,intent_id,app_id,source,confidence,success,duration_ms,error,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `, [
      entry.id, entry.intentId, entry.appId, entry.source,
      entry.confidence ?? null, entry.success ? 1 : 0,
      entry.durationMs ?? null, entry.error ?? null, now(),
    ]);
  }

  close(): void {
    this.save();
    this.db.close();
  }
}
