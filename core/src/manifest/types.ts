/**
 * AutoBridge Manifest Format v1
 * The neutral, stack-agnostic schema that all SDKs speak.
 * This is the contract language of the entire system.
 */

export type PrimitiveType = 'string' | 'number' | 'boolean' | 'null';
export type ComplexType = 'object' | 'array' | 'any';
export type FieldType = PrimitiveType | ComplexType;

export interface FieldSchema {
  type: FieldType;
  required?: boolean;
  description?: string;
  items?: FieldSchema;           // for arrays
  properties?: Record<string, FieldSchema>; // for objects
  enum?: (string | number)[];
  example?: unknown;
}

export interface AuthRequirement {
  type: 'none' | 'bearer' | 'apikey' | 'basic' | 'custom';
  header?: string;
  description?: string;
}

// ─── BACKEND CAPABILITY ───────────────────────────────────────────────────────
// What a backend declares it CAN do

export interface BackendCapability {
  id: string;                    // unique within the backend
  name: string;                  // human-readable: "user data", "create order"
  description?: string;
  tags?: string[];               // semantic tags for matching: ["users", "read", "list"]
  
  input?: Record<string, FieldSchema>;   // accepted parameters
  output: Record<string, FieldSchema>;   // shape of what it returns
  
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; // hint, not enforced
  auth?: AuthRequirement;
  
  // Runtime info
  handler: string;               // internal reference to the actual function/route
  stack: string;                 // "python-flask", "node-express", "go-gin", etc.
  version?: string;
}

// ─── FRONTEND INTENT ─────────────────────────────────────────────────────────
// What a frontend declares it NEEDS

export interface FrontendIntent {
  id: string;
  name: string;                  // human-readable: "list users with name and email"
  description?: string;
  tags?: string[];
  
  expectedShape?: Record<string, FieldSchema>;  // the shape it expects back
  requiredFields?: string[];     // minimum fields it needs
  
  action?: 'read' | 'create' | 'update' | 'delete' | 'subscribe'; // hint
  priority?: 'critical' | 'high' | 'normal' | 'low';
  
  // Where this intent originates
  component?: string;            // "UserList", "Dashboard", etc.
  framework?: string;            // "react", "vue", "svelte", etc.
}

// ─── BACKEND MANIFEST ────────────────────────────────────────────────────────
// Full declaration from a backend service

export interface BackendManifest {
  serviceId: string;
  serviceName: string;
  version: string;
  baseUrl: string;
  stack: string;
  capabilities: BackendCapability[];
  registeredAt: string;          // ISO timestamp
  lastHeartbeat?: string;
}

// ─── FRONTEND MANIFEST ───────────────────────────────────────────────────────
// Full declaration from a frontend app

export interface FrontendManifest {
  appId: string;
  appName: string;
  version: string;
  framework: string;
  intents: FrontendIntent[];
  registeredAt: string;
}

// ─── CONTRACT ────────────────────────────────────────────────────────────────
// A resolved wiring between a frontend intent and backend capability

export type ContractStatus = 'active' | 'pending_approval' | 'rejected' | 'drifted' | 'deprecated';
export type ContractSource = 'convention' | 'llm' | 'manual';

export interface ContractTransform {
  request?: string;              // JS transform function as string (input → backend params)
  response?: string;             // JS transform function as string (backend output → frontend shape)
}

export interface Contract {
  id: string;
  intentId: string;
  capabilityId: string;
  appId: string;
  serviceId: string;
  
  // Resolution metadata
  source: ContractSource;
  confidence: number;            // 0–1
  reasoning?: string;            // why this was matched (especially for LLM)
  
  // The actual wiring
  generatedEndpoint: string;     // e.g. "/bridge/users/list"
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  transforms?: ContractTransform;
  
  // Lifecycle
  status: ContractStatus;
  createdAt: string;
  updatedAt: string;
  lastUsed?: string;
  usageCount: number;
  
  // Requires human approval before going live?
  requiresApproval: boolean;
  approvedBy?: string;
  approvedAt?: string;
}

// ─── REGISTRY MESSAGES ────────────────────────────────────────────────────────
// SDK ↔ Bridge communication

export interface RegisterBackendRequest {
  manifest: BackendManifest;
  apiKey?: string;               // project-level bridge API key
}

export interface RegisterFrontendRequest {
  manifest: FrontendManifest;
  apiKey?: string;
}

export interface ResolveIntentRequest {
  intentId: string;
  appId: string;
  forceReresolve?: boolean;
  llmApiKey?: string;            // request-level Claude API key
}

export interface ResolveIntentResponse {
  contract: Contract | null;
  status: 'resolved' | 'pending' | 'failed' | 'convention_only';
  message?: string;
}

export interface HeartbeatRequest {
  serviceId?: string;
  appId?: string;
  timestamp: string;
}
