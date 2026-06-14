# WireBridge

**The runtime layer that wires your frontend to your backend — automatically.**

WireBridge eliminates the manual work of connecting frontend components to backend APIs. Instead of writing endpoints, route handlers, and fetch calls by hand for every feature, you declare what your backend *can do* and what your frontend *needs* — WireBridge figures out the rest at runtime.

No code generation. No build step. No schemas to sync. It just works while your servers are running.

---

## The problem it solves

Building a new feature today looks like this:

1. Backend engineer writes an endpoint (`POST /api/orders`)
2. Backend engineer documents it (maybe)
3. Frontend engineer reads the docs, writes a fetch call
4. They argue about the response shape
5. One of them changes something; the other breaks

Every new feature repeats this cycle. The more features, the more coordination overhead, the more drift between what the backend actually returns and what the frontend expects.

**WireBridge replaces this entire loop.**

Your backend declares its capabilities once. Your frontend declares its needs once. WireBridge resolves the connection using convention matching (instant, free) or an LLM as a fallback (once per novel pairing, then cached forever). The bridge proxies requests at runtime — no client-side URL management, no manual route wiring, no sync meetings.

---

## How it works

```
┌──────────────────────────────────────────────────────────────────────┐
│                          WIREBRIDGE CORE                             │
│                                                                      │
│   Backend Registry              Frontend Registry                    │
│   "I can do these things"  ←→  "I need these things"                │
│            ↓                            ↓                            │
│       ┌────────────────────────────────────┐                         │
│       │  1. Convention Resolver            │  ← instant, free        │
│       │     name + tag + shape matching    │                         │
│       │           ↓ on miss               │                         │
│       │  2. LLM Synthesizer               │  ← once per pairing     │
│       │     any provider you choose       │                         │
│       │           ↓                       │                         │
│       │  3. Contract Store (SQLite/PG)     │  ← persisted forever    │
│       │     learned connections cached     │                         │
│       └────────────────────────────────────┘                         │
│                     ↓                                                │
│              Proxy Layer                                             │
│         /bridge/* → real backend                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### Resolution modes

**Convention mode** runs first — always. It uses token overlap, semantic synonym expansion, tag matching, HTTP method hints, and output shape compatibility to score every backend capability against the frontend's intent. If the best score clears the threshold (default 0.55), it resolves instantly with zero LLM calls.

**LLM mode** kicks in only when convention fails. The synthesizer sends the full intent context and the complete list of available capabilities to your chosen LLM provider, which reasons about the best match and optionally generates transform functions if the request/response shapes need adapting. The result is stored as a contract — the LLM is never called again for the same pairing.

**The LLM is a one-time cost per novel connection.** After that, it's pure convention.

### Contracts

Every resolved connection becomes a **contract** — a stored record of:

- Which frontend intent maps to which backend capability
- The generated endpoint (`/bridge/users/list`)
- The HTTP method
- Any request/response transforms
- The confidence score and reasoning
- The LLM provider and model used (if synthesized by LLM)
- Source (`convention` or `llm`)

Contracts are persisted in SQLite (dev) or PostgreSQL (production). They survive restarts, accumulate over time, and make the system smarter. High-confidence LLM contracts (≥ 0.85) are auto-approved. Lower-confidence ones go to the dashboard for human review.

### Drift detection

When a backend re-registers with changed capabilities, the drift detector compares old and new manifests. Removed capabilities, schema changes, method changes, and handler path changes all invalidate dependent contracts and queue them for re-resolution. Backends that stop heartbeating go offline automatically and their contracts drift.

---

## Quick start

### Prerequisites

- Node.js 18+
- An API key for any supported LLM provider — or Ollama / LM Studio running locally (no key needed)

### 1. Start the bridge server

```bash
git clone https://github.com/davistolu/autobrigde
cd autobridge/core
npm install
npm run dev
```

The bridge starts on `http://localhost:7331`.

```
🌉 WireBridge running on http://localhost:7331
```

### 2. Configure your LLM provider

Open the dashboard at `http://localhost:5173` → API Keys tab, or set an environment variable:

```bash
# Anthropic (Claude)
export WIREBRIDGE_ANTHROPIC_KEY=sk-ant-...

# OpenAI
export WIREBRIDGE_OPENAI_KEY=sk-...

# Google Gemini
export WIREBRIDGE_GOOGLE_KEY=AIza...

# Groq
export WIREBRIDGE_GROQ_KEY=gsk_...

# Ollama (local — no key needed, just have Ollama running)
# WireBridge detects it automatically at http://localhost:11434
```

If no key is configured, WireBridge runs in convention-only mode — it still wires connections, just without LLM fallback for novel pairings.

### 3. Register your backend

**Python (Flask / FastAPI / Django / Bottle)**

```python
pip install wirebridge-sdk

from wirebridge import BridgeClient, BridgeConfig, string_field, array_field, object_field

bridge = BridgeClient(BridgeConfig(
    service_name="user-service",
    base_url="http://localhost:5000",
))

@bridge.capability(
    "list users",
    output={"users": array_field(object_field({
        "id":    number_field(),
        "name":  string_field(),
        "email": string_field(),
        "role":  string_field(),
    }))},
    tags=["users", "read", "list"],
    method="GET",
    handler="/api/users",
)
def get_users():
    return db.get_all_users()

bridge.register()
```

**TypeScript / Node.js (Express / Fastify / Next.js)**

```typescript
import { BackendBridge, s } from '@wirebridge/sdk';

const bridge = new BackendBridge({
    serviceName: 'user-service',
    baseUrl: 'http://localhost:3000',
});

bridge.capability({
    name: 'list users',
    handler: '/api/users',
    method: 'GET',
    tags: ['users', 'read', 'list'],
    output: {
        users: s.array(s.object({
            id:    s.number(),
            name:  s.string(),
            email: s.string(),
            role:  s.string(),
        })),
    },
});

await bridge.register();
```

**Go (net/http / Gin / Echo / Chi / Fiber)**

```go
import wirebridge "github.com/wirebridge/sdk-go"

bridge := wirebridge.New(wirebridge.Config{
    ServiceName: "user-service",
    BaseURL:     "http://localhost:8080",
})

bridge.Capability(wirebridge.Cap{
    Name:    "list users",
    Handler: "/api/users",
    Method:  "GET",
    Tags:    []string{"users", "read", "list"},
    Output: wirebridge.Schema{
        "users": wirebridge.ArrayOf(wirebridge.ObjectOf(wirebridge.Fields{
            "id":    wirebridge.Number(),
            "name":  wirebridge.String(),
            "email": wirebridge.String(),
        })),
    },
})

bridge.MustRegister()
defer bridge.Stop()
```

**Ruby (Rails / Sinatra / Rack)**

```ruby
# config/initializers/wirebridge.rb
require "wirebridge"

WireBridge::Rails.setup(
    service_name: "user-service",
    base_url: Rails.application.routes.url_helpers.root_url,
) do |bridge|
    bridge.capability(
        name:    "list users",
        handler: "/api/users",
        method:  "GET",
        tags:    %w[users read list],
        output:  {
            users: WireBridge.array_of(WireBridge.object_of(
                id:    WireBridge.number,
                name:  WireBridge.string,
                email: WireBridge.string,
            ))
        }
    )
end
```

**PHP / Laravel**

```bash
composer require wirebridge/sdk-laravel
php artisan vendor:publish --tag=wirebridge-config
```

```php
use WireBridge\BridgeClient;
use WireBridge\Schema;

$bridge = new BridgeClient([
    'service_name' => 'user-service',
    'base_url'     => config('app.url'),
]);

$bridge
    ->capability('list users', [
        'handler' => '/api/users',
        'method'  => 'GET',
        'tags'    => ['users', 'read', 'list'],
        'output'  => [
            'users' => Schema::arrayOf(Schema::objectOf([
                'id'    => Schema::number(),
                'name'  => Schema::string(),
                'email' => Schema::string(),
            ])),
        ],
    ])
    ->register();
```

### 4. Connect your frontend

```typescript
import { FrontendBridge } from '@wirebridge/sdk';

const bridge = new FrontendBridge({
    appName: 'my-app',
    framework: 'react',
});

await bridge.register();

// Declare what you need — WireBridge finds the endpoint
const endpoint = bridge.intent('list users with name and email', {
    requiredFields: ['name', 'email'],
    action: 'read',
    tags: ['users'],
});

const { users } = await fetch(endpoint).then(r => r.json());
```

### 5. Open the dashboard

```bash
cd dashboard
npm install
npm run dev
# Dashboard at http://localhost:5173
```

---

## LLM providers

WireBridge supports eight providers out of the box. You can switch providers at any time from the dashboard — each contract records which model resolved it, so you always know what made each decision.

| Provider | Type | Models | Key required |
|---|---|---|---|
| **Anthropic** | Cloud | Claude Sonnet 4.5, Opus 4.5, Haiku 4.5 | Yes |
| **OpenAI** | Cloud | GPT-4o, GPT-4o Mini, o1, GPT-3.5 Turbo | Yes |
| **Google Gemini** | Cloud | Gemini 2.0 Flash, 1.5 Pro, 1.5 Flash | Yes |
| **Groq** | Cloud | Llama 3.3 70B, Llama 3.1 8B, Mixtral, Gemma 2 | Yes |
| **Together AI** | Cloud | Llama 3.3 70B Turbo, Mixtral, Qwen 2.5 | Yes |
| **Ollama** | Local | Llama 3.3, Mistral, CodeLlama, Phi-4, Gemma 3, DeepSeek R1, Qwen 2.5 | No |
| **LM Studio** | Local | Any model loaded in LM Studio | No |
| **Custom endpoint** | Any | Any OpenAI-compatible API | Optional |

### Configuring providers

**Via environment variables:**

```bash
export WIREBRIDGE_ANTHROPIC_KEY=sk-ant-...
export WIREBRIDGE_OPENAI_KEY=sk-...
export WIREBRIDGE_GOOGLE_KEY=AIza...
export WIREBRIDGE_GROQ_KEY=gsk_...
export WIREBRIDGE_TOGETHER_KEY=...
```

**Via the dashboard (API Keys tab):**

Select a provider from the grid, choose a model, paste your API key, and save. The dashboard shows each saved configuration with its provider, model, and masked key. The topmost saved configuration is the active one.

**Via `bridge.config.ts`:**

```typescript
export default {
    llmProviderId: 'openai',
    llmModel:      'gpt-4o',
    llmApiKey:     process.env.WIREBRIDGE_OPENAI_KEY,
};
```

### Using local models (Ollama)

No key needed. Just have Ollama running:

```bash
# Install Ollama from https://ollama.com
ollama pull llama3.3
ollama serve
```

WireBridge connects to Ollama at `http://localhost:11434` automatically. Select Ollama in the dashboard API Keys tab and choose your model. If your Ollama is running on a different host, enter the custom base URL.

### Using LM Studio

Open LM Studio, load any model, and enable the local server (default port 1234). In the dashboard, select LM Studio and enter the model name exactly as it appears in LM Studio.

### Using a custom endpoint

Any OpenAI-compatible API works — vLLM, llama.cpp server, Mistral self-hosted, etc. Select "Custom endpoint" in the dashboard, enter the base URL and model name, and optionally an API key.

### Key resolution order

When WireBridge needs to make an LLM synthesis call, it resolves the key in this order:

| Priority | Source |
|---|---|
| 1 | Per-request key passed in the SDK call |
| 2 | `llmApiKey` in `bridge.config.ts` |
| 3 | `WIREBRIDGE_<PROVIDER>_KEY` environment variable |
| 4 | Configuration saved in the dashboard |
| — | Convention-only mode (no LLM synthesis) |

---

## Contract lifecycle

```
Intent declared
      │
      ▼
Convention resolver
      │
      ├─ Match found (confidence ≥ 0.55) ────────────────► Active contract ✓
      │
      └─ No match
              │
              ▼
         LLM Synthesizer
         (your chosen provider)
              │
              ├─ Confidence ≥ 0.85 ──────────────────────► Auto-approved ✓
              │
              ├─ Confidence 0.55–0.84 ───────────────────► Pending approval
              │                                             (review in dashboard)
              │
              ├─ Confidence < 0.55 ──────────────────────► No match
              │                                             (retried when new backends register)
              │
              └─ No provider configured ────────────────► Convention-only mode
```

Once a contract is active, requests to `/bridge/<endpoint>` are proxied directly to the backend. No re-resolution. The LLM is never called again for the same pairing.

### Drift

When a backend re-registers with changes:

- **Capability removed** → dependent contracts immediately marked `drifted`
- **Output schema changed** → contracts marked `drifted`
- **HTTP method changed** → contracts marked `drifted`
- **Handler path changed** → contracts marked `drifted`
- **Name or tags changed** → non-breaking; contracts stay active

When a backend stops heartbeating for 90 seconds, all its contracts drift and it shows offline in the dashboard.

---

## Dashboard

Open `http://localhost:5173` after running `npm run dev` in the `dashboard/` directory.

### Contracts tab

Lists all contracts with status, source, HTTP method, generated endpoint, confidence score, and usage count. Click any contract to see intent ID, capability ID, the LLM provider and model used, reasoning, and timestamps. Contracts pending approval show **Approve** and **Reject** buttons.

### Services tab

Shows all registered backends with live/offline indicators, stack, version, base URL, and capability count. Shows registered frontend apps and their intent counts.

### Live tab

Real-time event stream. Every contract resolution, drift event, backend registration, and resolution failure appears here as it happens, with timestamps and metadata.

| Event | Meaning |
|---|---|
| ⛓ Contract Resolved | New connection wired (convention or LLM) |
| ✓ Contract Approved | Pending contract approved |
| ✗ Contract Rejected | Contract rejected |
| ⚠ Contract Drifted | Contract invalidated by capability change |
| ⬆ Backend Online | New backend registered |
| ⬇ Backend Offline | Backend missed heartbeat threshold |
| ◎ Frontend Connected | New frontend app registered |
| ≠ Drift Detected | Backend manifest changed |
| ? Resolution Failed | Intent could not be resolved |

### API Keys tab

Provider grid — eight options: Anthropic, OpenAI, Google Gemini, Groq, Together AI, Ollama, LM Studio, and Custom. Selecting a provider shows the right configuration form for that provider: model picker, optional base URL for local/custom providers, and an API key field that hides itself for providers that don't need one. Saved configurations show the provider, model, and masked key. The topmost is always the active one.

---

## Stack support

| Language | Framework | Install | Status |
|---|---|---|---|
| Python | Flask | `pip install wirebridge-sdk`  
| Python | FastAPI | `pip install wirebridge-sdk` 
| Python | Django | `pip install wirebridge-sdk` 
| Python | Bottle | `pip install wirebridge-sdk` 
| TypeScript | Express | `npm i @wirebridge/sdk` 
| TypeScript | Fastify | `npm i @wirebridge/sdk` 
| TypeScript | Next.js | `npm i @wirebridge/sdk` 
| JavaScript | Any Node.js | `npm i @wirebridge/sdk` 
| Go | net/http | `go get github.com/wirebridge/sdk-go` 
| Go | Gin | `go get github.com/wirebridge/sdk-go` 
| Go | Echo / Chi / Fiber | `go get github.com/wirebridge/sdk-go` 
| Ruby | Rails | `gem install wirebridge-sdk` 
| Ruby | Sinatra | `gem install wirebridge-sdk`
| Ruby | Rack | `gem install wirebridge-sdk` 
| PHP | Laravel | `composer require wirebridge/sdk-laravel` 
| PHP | Symfony | Coming soon | 🔜 |
| Java | Spring Boot | Coming soon | 🔜 |
| Rust | Axum / Actix | Coming soon | 🔜 |

---

## Project structure

```
wirebridge/
│
├── core/                        # Bridge server — the heart of everything
│   └── src/
│       ├── manifest/
│       │   └── types.ts              # Neutral schema format all SDKs speak
│       ├── resolver/
│       │   └── convention.ts         # Deterministic convention matching engine
│       ├── synthesizer/
│       │   ├── providers.ts          # Provider registry — all 8 supported providers
│       │   ├── adapters.ts           # Per-format API callers (Anthropic, OpenAI-compat, Google)
│       │   └── llm.ts                # Provider-agnostic synthesizer
│       ├── proxy/
│       │   └── proxy.ts              # Runtime request forwarder with transforms
│       ├── store/
│       │   └── contract-store.ts     # SQLite contract + manifest + provider config persistence
│       ├── security/
│       │   └── crypto.ts             # AES-256-GCM key encryption
│       ├── events/
│       │   └── event-bus.ts          # SSE broadcaster for real-time dashboard
│       ├── drift/
│       │   └── detector.ts           # Manifest diffing + contract invalidation
│       └── server.ts                 # Fastify HTTP server — wires it all together
│
├── sdk-python/                  # Python SDK
├── sdk-ts/                      # TypeScript/JS SDK
├── sdk-go/                      # Go SDK
├── sdk-ruby/                    # Ruby SDK
├── sdk-laravel/                 # Laravel/PHP SDK
│
├── dashboard/                   # React management dashboard
│   └── src/
│       └── App.jsx              # Contracts, Services, Live, API Keys (multi-provider)
│
├── examples/
│   ├── python-flask/
│   ├── react-frontend/
│   ├── go-http/
│   ├── ruby-rails/
│   └── laravel/
│
└── bridge.config.ts             # Project-level bridge configuration
```

---

## Configuration reference

### `bridge.config.ts`

```typescript
export default {
    // Server
    port:    7331,
    dbPath:  '.wirebridge/bridge.db',   // SQLite for dev

    // LLM provider
    llmProviderId: 'anthropic',         // Provider ID — see table above
    llmModel:      'claude-sonnet-4-5', // Model string sent to the API
    llmApiKey:     process.env.WIREBRIDGE_ANTHROPIC_KEY,
    llmBaseUrl:    undefined,           // Override for local/custom providers

    // Contract approval
    autoApprove:          true,
    autoApproveThreshold: 0.85,         // Contracts above this are auto-approved
};
```

### Environment variables

| Variable | Description |
|---|---|
| `WIREBRIDGE_ANTHROPIC_KEY` | Anthropic API key |
| `WIREBRIDGE_OPENAI_KEY` | OpenAI API key |
| `WIREBRIDGE_GOOGLE_KEY` | Google Gemini API key |
| `WIREBRIDGE_GROQ_KEY` | Groq API key |
| `WIREBRIDGE_TOGETHER_KEY` | Together AI API key |
| `WIREBRIDGE_ENCRYPTION_SECRET` | Secret for key encryption at rest — **change in production** |
| `WIREBRIDGE_BRIDGE_URL` | Bridge server URL used by SDKs (default: `http://localhost:7331`) |
| `WIREBRIDGE_SERVICE_ID` | Stable service ID — set this in production so contracts survive restarts |

---

## Bridge API reference

The bridge exposes an HTTP API on `http://localhost:7331`:

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check + live stats |
| `POST` | `/registry/backend` | Register a backend manifest |
| `POST` | `/registry/frontend` | Register a frontend manifest |
| `POST` | `/registry/heartbeat` | Keep a backend alive |
| `POST` | `/resolve` | Manually trigger intent resolution |
| `*` | `/bridge/*` | Proxy any method to backend via contract |
| `GET` | `/events` | SSE stream of real-time bridge events |
| `GET` | `/admin/contracts` | List all contracts |
| `PATCH` | `/admin/contracts/:id` | Approve or reject a contract |
| `GET` | `/admin/backends` | List registered backends |
| `GET` | `/admin/frontends` | List registered frontends |
| `GET` | `/admin/providers` | List all supported LLM providers and their models |
| `GET` | `/admin/keys` | List saved provider configurations (masked) |
| `POST` | `/admin/keys` | Save a provider configuration |
| `DELETE` | `/admin/keys/:id` | Delete a saved configuration |

---

## Production deployment

### Use a stable service ID

Service IDs are auto-generated in development. Set them explicitly in production so contracts survive restarts:

```bash
WIREBRIDGE_SERVICE_ID=prod-user-service-v1
```

### Change the encryption secret

```bash
export WIREBRIDGE_ENCRYPTION_SECRET=your-strong-random-secret-here
```

The default is hardcoded and public. Change it before going live.

### Running behind nginx

SSE requires buffering disabled for the `/events` endpoint:

```nginx
location /events {
    proxy_pass         http://localhost:7331;
    proxy_buffering    off;
    proxy_cache        off;
    proxy_read_timeout 3600s;
    proxy_set_header   Connection '';
    chunked_transfer_encoding on;
}

location / {
    proxy_pass http://localhost:7331;
}
```

---

## Security

**API keys** are AES-256-GCM encrypted before storage, derived from `WIREBRIDGE_ENCRYPTION_SECRET`. They are never logged, never returned in full via any API endpoint, and displayed only as masked previews (`sk-ant-a••••••••1234`) in the dashboard.

**Generated endpoints** require an active contract. There is no way to proxy a request through WireBridge without a contract existing for that endpoint. Contracts in `pending_approval`, `rejected`, `drifted`, or `deprecated` status return appropriate error responses.

**Auth passthrough** — the proxy layer forwards `Authorization` and `X-Api-Key` headers from incoming requests to the backend. Backend auth is never bypassed.

**Admin API** — the `/admin/*` routes are unauthenticated in the current version. In production, put the bridge behind your network perimeter or add middleware token verification.

---

## FAQ

**Does this add latency?**
Convention-resolved contracts add a single SQLite lookup plus the proxy HTTP hop — under 5ms on local networks. The `X-WireBridge-Duration` response header shows the exact overhead on every request.

**What happens if the bridge goes down?**
Requests to `/bridge/*` fail. The bridge is a single point of failure today — run it with PM2 or systemd. Multi-instance support with shared PostgreSQL is on the roadmap.

**Can I use this without any LLM?**
Yes. Convention matching resolves the majority of connections when naming is consistent. Patterns like `list <resource>`, `create <resource>`, `get <resource> by id` almost always match without LLM involvement.

**Which LLM provider should I use?**
Convention matching covers most cases so any provider works well. For synthesis quality, Claude Sonnet and GPT-4o perform best. For speed, Groq's Llama 3.3 70B is fast. For fully offline/private use, Ollama with Llama 3.3 works well.

**Does the LLM see my actual data?**
No. The LLM only sees intent names, tags, and schema field names — no actual request/response payloads. The synthesis call happens once at wiring time, not at request time.

**What's the difference between `convention` and `llm` contracts?**
Convention contracts are resolved deterministically — no AI involved. LLM contracts were synthesized by your chosen model, which is recorded in the contract reasoning. Both behave identically once active. The dashboard highlights LLM contracts so you can review them when confidence is below the auto-approve threshold.

---

## License

Apache 2.0
