# AutoBridge

**The runtime layer that wires your frontend to your backend — automatically.**

AutoBridge eliminates the manual work of connecting frontend components to backend APIs. Instead of writing endpoints, route handlers, and fetch calls by hand for every feature, you declare what your backend *can do* and what your frontend *needs* — AutoBridge figures out the rest at runtime.

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

**AutoBridge replaces this entire loop.**

Your backend declares its capabilities once. Your frontend declares its needs once. AutoBridge resolves the connection using convention matching (instant, free) or Claude as a fallback (once per novel pairing, then cached forever). The bridge proxies requests at runtime — no client-side URL management, no manual route wiring, no sync meetings.

---

## How it works

```
┌──────────────────────────────────────────────────────────────────────┐
│                          AUTOBRIDGE CORE                             │
│                                                                      │
│   Backend Registry              Frontend Registry                    │
│   "I can do these things"  ←→  "I need these things"                │
│            ↓                            ↓                            │
│       ┌────────────────────────────────────┐                         │
│       │  1. Convention Resolver            │  ← instant, free        │
│       │     name + tag + shape matching    │                         │
│       │           ↓ on miss               │                         │
│       │  2. LLM Synthesizer (Claude)       │  ← once per pairing     │
│       │     reasons about intent vs cap    │                         │
│       │           ↓                       │                         │
│       │  3. Contract Store (SQLite/PG)     │  ← persisted forever    │
│       │     learned connections cached     │                         │
│       └────────────────────────────────────┘                         │
│                     ↓                                                │
│              Proxy Layer                                             │
│         /bridge/* → real backend                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### The two resolution modes

**Convention mode** runs first — always. It uses token overlap, semantic synonym expansion, tag matching, HTTP method hints, and output shape compatibility to score every backend capability against the frontend's intent. If the best score clears the threshold (default 0.55), it resolves instantly without any LLM call.

**LLM mode** kicks in only when convention fails. Claude receives the full intent context and the complete list of available capabilities, reasons about the best match, and optionally generates transform functions if the request/response shapes need adapting. The result is stored as a contract. The next time the same intent appears, no LLM call is made.

The LLM is a **one-time cost per novel connection**. After that, it's convention all the way.

### Contracts

Every resolved connection becomes a **contract** — a stored record of:
- Which frontend intent maps to which backend capability
- The generated endpoint (`/bridge/users/list`)
- The HTTP method
- Any request/response transforms
- The confidence score and reasoning
- Source (`convention` or `llm`)

Contracts are persisted in SQLite (development) or PostgreSQL (production). They survive restarts. They accumulate over time, making the system smarter. High-confidence LLM contracts (≥ 0.85) are auto-approved. Lower-confidence ones go to the dashboard for human review.

### Drift detection

When a backend re-registers with changed capabilities, the drift detector compares old and new manifests. If a capability was removed or its output schema changed, all dependent contracts are marked `drifted` and queued for re-resolution. If a backend goes offline (missed heartbeats), its contracts drift automatically. The dashboard shows all of this in real time.

---

## Quick start

### Prerequisites

- Node.js 18+
- An Anthropic API key (only needed for LLM synthesis; convention matching works without one)

### 1. Start the bridge server

```bash
git clone https://github.com/autobridge/autobridge
cd autobridge/core
npm install
npm run dev
```

The bridge starts on `http://localhost:7331`. You'll see:

```
🌉 AutoBridge running on http://localhost:7331
```

### 2. Set your API key (optional but recommended)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Without a key, AutoBridge runs in convention-only mode. This works well once you have established conventions, but the LLM covers the gaps on novel pairings.

### 3. Register your backend

Pick your stack:

**Python (Flask / FastAPI / Django / Bottle)**

```python
pip install autobridge-sdk

from autobridge import BridgeClient, BridgeConfig, string_field, array_field, object_field, number_field

bridge = BridgeClient(BridgeConfig(
    service_name="user-service",
    base_url="http://localhost:5000",
))

@bridge.capability(
    "list users",
    output={
        "users": array_field(object_field({
            "id":    number_field(),
            "name":  string_field(),
            "email": string_field(),
            "role":  string_field(),
        }))
    },
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
import { BackendBridge, s } from '@autobridge/sdk';

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
import autobridge "github.com/autobridge/sdk-go"

bridge := autobridge.New(autobridge.Config{
    ServiceName: "user-service",
    BaseURL:     "http://localhost:8080",
})

bridge.Capability(autobridge.Cap{
    Name:    "list users",
    Handler: "/api/users",
    Method:  "GET",
    Tags:    []string{"users", "read", "list"},
    Output: autobridge.Schema{
        "users": autobridge.ArrayOf(autobridge.ObjectOf(autobridge.Fields{
            "id":    autobridge.Number(),
            "name":  autobridge.String(),
            "email": autobridge.String(),
        })),
    },
})

bridge.MustRegister()
defer bridge.Stop()
```

**Ruby (Rails / Sinatra / Rack)**

```ruby
# config/initializers/autobridge.rb
require "autobridge"

AutoBridge::Rails.setup(
    service_name: "user-service",
    base_url: Rails.application.routes.url_helpers.root_url,
) do |bridge|
    bridge.capability(
        name:    "list users",
        handler: "/api/users",
        method:  "GET",
        tags:    %w[users read list],
        output:  {
            users: AutoBridge.array_of(AutoBridge.object_of(
                id:    AutoBridge.number,
                name:  AutoBridge.string,
                email: AutoBridge.string,
            ))
        }
    )
end
```

**PHP / Laravel**

```bash
composer require autobridge/sdk-laravel
php artisan vendor:publish --tag=autobridge-config
```

```php
// app/Providers/AppServiceProvider.php
use AutoBridge\BridgeClient;
use AutoBridge\Schema;

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

Or use the Facade:

```php
use AutoBridge\Facades\Bridge;

Bridge::capability('list users', [...])
      ->capability('create user', [...])
      ->register();
```

### 4. Connect your frontend

**React / Next.js / Vue / Any JS framework**

```typescript
import { FrontendBridge } from '@autobridge/sdk';

const bridge = new FrontendBridge({
    appName: 'my-app',
    framework: 'react',
});

// Register on startup — resolves all intents against registered backends
await bridge.register();

// Declare what you need — AutoBridge finds the endpoint
const endpoint = bridge.intent('list users with name and email', {
    requiredFields: ['name', 'email'],
    action: 'read',
    tags: ['users'],
});

// Use it like a normal fetch
const { users } = await fetch(endpoint).then(r => r.json());
```

Or use the fetch helper:

```typescript
const { users } = await bridge.fetch('list users').then(r => r.json());
```

### 5. Open the dashboard

```bash
cd dashboard
npm install
npm run dev
# Dashboard at http://localhost:5173
```

The dashboard shows:
- All active, pending, and drifted contracts
- Registered backends and frontends with live/offline status
- Real-time event stream (contract resolutions, drift alerts, backend registrations)
- API key management (encrypted at rest)
- Approve or reject LLM-synthesized contracts before they go live

---

## Configuration

### Bridge server (`bridge.config.ts`)

```typescript
export default {
    port: 7331,
    dbPath: '.autobridge/bridge.db',   // SQLite for dev; use PG connection string for prod

    // Claude API key — see key resolution order below
    llmApiKey: process.env.ANTHROPIC_API_KEY,
    llmModel: 'claude-sonnet-4-20250514',

    // Auto-approve LLM contracts above this confidence (0–1)
    autoApprove: true,
    autoApproveThreshold: 0.85,
};
```

### API key resolution order

AutoBridge resolves the Claude API key in this order, using the first one found:

| Priority | Source |
|---|---|
| 1 | Per-request key passed in the SDK call |
| 2 | `llmApiKey` in `bridge.config.ts` |
| 3 | `AUTOBRIDGE_ANTHROPIC_KEY` environment variable |
| 4 | `ANTHROPIC_API_KEY` environment variable |
| 5 | Key saved in the dashboard (encrypted in DB) |
| — | Convention-only mode (no LLM synthesis) |

Keys are AES-256-GCM encrypted at rest and never logged or exposed via any API response.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Claude API key for LLM synthesis |
| `AUTOBRIDGE_ANTHROPIC_KEY` | — | AutoBridge-specific key (takes priority over above) |
| `AUTOBRIDGE_ENCRYPTION_SECRET` | `autobridge-dev-secret-...` | Secret for key encryption — **change in production** |
| `AUTOBRIDGE_BRIDGE_URL` | `http://localhost:7331` | Bridge server URL (used by SDKs) |
| `AUTOBRIDGE_SERVICE_ID` | auto-generated | Stable service identity across restarts (set in prod) |

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
         LLM Synthesizer (Claude)
              │
              ├─ Confidence ≥ 0.85 ──────────────────────► Auto-approved ✓
              │
              ├─ Confidence 0.55–0.84 ───────────────────► Pending approval
              │                                             (review in dashboard)
              │
              ├─ Confidence < 0.55 ──────────────────────► No match
              │                                             (retried when new backends register)
              │
              └─ No API key ────────────────────────────► Convention-only mode
```

Once a contract is active, requests to `/bridge/<endpoint>` are proxied directly to the backend. No re-resolution. The LLM is never called again for the same intent–capability pair.

### Drift

When a backend re-registers with changes:

- **Capability removed** → dependent contracts immediately marked `drifted`, re-resolved
- **Output schema changed** → contracts marked `drifted` (shape may not match what frontend expects)
- **HTTP method changed** → contracts marked `drifted` (proxy would use wrong method)
- **Handler path changed** → contracts marked `drifted` (proxy would route to wrong URL)
- **Name/tags changed** → noted but non-breaking; contracts stay active

When a backend stops sending heartbeats for 90 seconds, all its contracts drift and the dashboard shows it offline.

---

## Dashboard

Open `http://localhost:5173` after running `npm run dev` in the `dashboard/` directory.

### Contracts tab

Lists all contracts with their status, source (convention or LLM), HTTP method, generated endpoint, confidence score, and usage count. Click any contract to expand its full details — intent ID, capability ID, reasoning, timestamps.

Contracts pending approval show **Approve** and **Reject** buttons. Approving makes the contract active and the endpoint live. Rejecting marks it so a different resolution is attempted.

### Services tab

Shows all registered backend services with live/offline indicators (based on heartbeat age), their stack, version, base URL, and capability count. Shows registered frontend apps and their intent counts.

### Live tab

Real-time event stream from the bridge's SSE endpoint. Events appear as they happen:

| Event | Meaning |
|---|---|
| ⛓ Contract Resolved | New connection wired (convention or LLM) |
| ✓ Contract Approved | Pending contract approved in dashboard |
| ✗ Contract Rejected | Contract rejected |
| ⚠ Contract Drifted | Contract invalidated by capability change |
| ⬆ Backend Online | New backend registered |
| ⬇ Backend Offline | Backend missed heartbeat threshold |
| ◎ Frontend Connected | New frontend app registered |
| ≠ Drift Detected | Backend manifest changed |
| ? Resolution Failed | Intent could not be resolved |

### API Keys tab

Add and manage Claude API keys. Keys are stored AES-256 encrypted and shown only as masked previews (`sk-ant-a••••••••1234`). Delete keys individually. The active key is the most recently added one.

---

## Stack support

| Language | Framework/Runtime | Install | Status |
|---|---|---|---|
| Python | Flask | `pip install autobridge-sdk` | ✅ Full |
| Python | FastAPI | `pip install autobridge-sdk` | ✅ Full |
| Python | Django | `pip install autobridge-sdk` | ✅ Full |
| Python | Bottle | `pip install autobridge-sdk` | ✅ Full |
| TypeScript | Express | `npm i @autobridge/sdk` | ✅ Full |
| TypeScript | Fastify | `npm i @autobridge/sdk` | ✅ Full |
| TypeScript | Next.js | `npm i @autobridge/sdk` | ✅ Full |
| JavaScript | Any Node.js | `npm i @autobridge/sdk` | ✅ Full |
| Go | net/http | `go get github.com/autobridge/sdk-go` | ✅ Full |
| Go | Gin | `go get github.com/autobridge/sdk-go` | ✅ Full |
| Go | Echo / Chi / Fiber | `go get github.com/autobridge/sdk-go` | ✅ Full |
| Ruby | Rails | `gem install autobridge-sdk` | ✅ Full |
| Ruby | Sinatra | `gem install autobridge-sdk` | ✅ Full |
| Ruby | Rack | `gem install autobridge-sdk` | ✅ Full |
| PHP | Laravel | `composer require autobridge/sdk-laravel` | ✅ Full |
| PHP | Symfony | Coming soon | 🔜 |
| Java | Spring Boot | Coming soon | 🔜 |
| Rust | Axum / Actix | Coming soon | 🔜 |

---

## Project structure

```
autobridge/
│
├── core/                        # Bridge server — the heart of everything
│   └── src/
│       ├── manifest/
│       │   └── types.ts         # Neutral schema format all SDKs speak
│       ├── resolver/
│       │   └── convention.ts    # Deterministic convention matching engine
│       ├── synthesizer/
│       │   └── llm.ts           # Claude-powered synthesis for novel pairings
│       ├── proxy/
│       │   └── proxy.ts         # Runtime request forwarder with transforms
│       ├── store/
│       │   └── contract-store.ts  # SQLite contract + manifest persistence
│       ├── security/
│       │   └── crypto.ts        # AES-256-GCM key encryption
│       ├── events/
│       │   └── event-bus.ts     # SSE broadcaster for real-time dashboard
│       ├── drift/
│       │   └── detector.ts      # Manifest diffing + contract invalidation
│       └── server.ts            # Fastify HTTP server — wires it all together
│
├── sdk-python/                  # Python SDK
│   └── autobridge/
│       └── __init__.py          # BridgeClient, schema helpers, Flask/FastAPI integration
│
├── sdk-ts/                      # TypeScript/JS SDK
│   └── src/
│       └── index.ts             # BackendBridge, FrontendBridge, schema helpers
│
├── sdk-go/                      # Go SDK
│   └── autobridge.go            # Client, schema types, net/http middleware, Gin helper
│
├── sdk-ruby/                    # Ruby SDK
│   └── lib/
│       └── autobridge.rb        # Client, Rails/Sinatra/Rack integrations
│
├── sdk-laravel/                 # Laravel/PHP SDK
│   ├── src/
│   │   ├── BridgeClient.php               # Core client
│   │   ├── Schema.php                     # Schema helpers
│   │   ├── AutoBridgeServiceProvider.php  # Laravel service provider
│   │   ├── Facades/Bridge.php             # Laravel facade
│   │   └── Support/RegisterCommand.php    # php artisan autobridge:register
│   └── config/autobridge.php              # Published config file
│
├── dashboard/                   # React management dashboard
│   └── src/
│       └── App.jsx              # Contracts, Services, Live events, API Keys tabs
│
├── examples/
│   ├── python-flask/            # Full Flask example
│   ├── react-frontend/          # Full React example
│   ├── go-http/                 # Go net/http example
│   ├── ruby-rails/              # Rails initializer example
│   └── laravel/                 # Laravel AppServiceProvider example
│
└── bridge.config.ts             # Project-level bridge configuration
```

---

## How the bridge API works

The bridge exposes its own HTTP API on `http://localhost:7331`. SDKs talk to this directly; you don't need to touch it, but it's useful to know:

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check + stats |
| `POST` | `/registry/backend` | Register a backend manifest |
| `POST` | `/registry/frontend` | Register a frontend manifest |
| `POST` | `/registry/heartbeat` | Keep a backend alive |
| `POST` | `/resolve` | Manually resolve an intent |
| `GET/POST/PUT/PATCH/DELETE` | `/bridge/*` | Proxy to backend via contract |
| `GET` | `/events` | SSE stream of real-time events |
| `GET` | `/admin/contracts` | List all contracts |
| `PATCH` | `/admin/contracts/:id` | Approve or reject a contract |
| `GET` | `/admin/backends` | List registered backends |
| `GET` | `/admin/frontends` | List registered frontends |
| `GET/POST/DELETE` | `/admin/keys` | Manage API keys |

---

## Production deployment

### Use a stable service ID

In development, service IDs are auto-generated. In production, set them explicitly so contracts survive restarts and deployments:

```bash
# .env or environment
AUTOBRIDGE_SERVICE_ID=prod-user-service-v1
```

### Change the encryption secret

```bash
export AUTOBRIDGE_ENCRYPTION_SECRET=your-strong-random-secret-here
```

Never use the default in production — it's hardcoded and public.

### Running behind nginx

SSE requires proxy buffering disabled for the `/events` endpoint:

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

**Keys** — API keys are AES-256-GCM encrypted before storage. The encryption key is derived from `AUTOBRIDGE_ENCRYPTION_SECRET`. Keys are never logged, never returned in full via any API endpoint, and shown only as masked previews in the dashboard.

**Generated endpoints** — Every `/bridge/*` endpoint requires an active contract. There is no way to call a backend through AutoBridge without a contract existing. Contracts that are `pending_approval`, `rejected`, `drifted`, or `deprecated` return appropriate error responses.

**Auth passthrough** — The proxy layer forwards `Authorization` and `X-Api-Key` headers from incoming requests to the backend. Backend auth is not bypassed.

**Admin API** — The `/admin/*` routes are unauthenticated in the current version. In production, put the bridge behind your network perimeter or add middleware token verification.

---

## FAQ

**Does this add latency?**
Convention-resolved contracts add a single SQLite lookup (sub-millisecond) plus the proxy HTTP hop. The `X-AutoBridge-Duration` response header shows total bridge overhead. Under 5ms on local networks in practice.

**What happens if the bridge goes down?**
Requests to `/bridge/*` fail with network errors. The bridge is a single point of failure today — run it with PM2 or systemd. Multi-instance support with a shared PostgreSQL store is on the roadmap.

**Can I use this without Claude?**
Yes. Convention matching resolves the majority of connections when your naming is consistent. If your teams use patterns like `list <resource>`, `create <resource>`, `get <resource> by id`, you may never need the LLM at all.

**Does the frontend have to go through the bridge URL?**
Yes — `bridge.fetch()` and `bridge.intent()` return `/bridge/*` URLs. This is intentional: the contract is the source of truth, and it lets you swap backends without touching frontend code.

**What's the difference between `convention` and `llm` contracts?**
Convention contracts are resolved deterministically by the scoring engine — no AI involved. LLM contracts were synthesized by Claude. Both behave identically once active. The dashboard highlights LLM contracts so a human can verify them when confidence is below the auto-approve threshold.

---

## License

MIT
