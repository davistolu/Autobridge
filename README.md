# AutoBridge

**Runtime wiring layer for any frontend ↔ any backend.**

AutoBridge sits between your frontend and backend, automatically generating the connections between them. No manual endpoint writing. Works with any stack. Production-grade.

```
Frontend declares what it needs  →  AutoBridge figures out the rest  →  Backend serves it
```

---

## How it works

1. **Backend registers capabilities** — what it can do, the shape of data it returns
2. **Frontend declares intents** — what it needs, roughly what it expects
3. **AutoBridge resolves** — convention matching first (instant), LLM synthesis as fallback (once, then cached)
4. **Contracts are stored** — every resolved connection is persisted. The LLM is only ever called once per novel pairing

```
┌─────────────────────────────────────────────────┐
│                  BRIDGE CORE                    │
│                                                 │
│  Frontend Registry   ←→   Backend Registry      │
│  (intents / needs)        (capabilities)        │
│          ↓                        ↓             │
│       Convention Resolver (instant, free)       │
│          ↓ on miss                              │
│       LLM Synthesizer (Claude, once per pair)   │
│          ↓                                      │
│       Contract Store (SQLite / PostgreSQL)      │
│          ↓                                      │
│       Proxy Layer (/bridge/* → real backend)    │
└─────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Start the bridge

```bash
cd core
npm install
npm run dev
# Bridge running at http://localhost:7331
```

### 2. Register your Python backend

```python
pip install autobridge-sdk

from autobridge import BridgeClient, BridgeConfig, string_field, array_field, object_field

bridge = BridgeClient(BridgeConfig(
    service_name="my-api",
    base_url="http://localhost:5000",
))

@bridge.capability(
    "list users",
    output={"users": array_field(object_field({"name": string_field(), "email": string_field()}))},
    tags=["users", "read"],
)
def get_users():
    return {"users": db.get_all_users()}

bridge.register()
```

### 3. Connect your frontend

```typescript
import { FrontendBridge } from '@autobridge/sdk';

const bridge = new FrontendBridge({ appName: 'my-app' });
await bridge.register();

// That's it — AutoBridge found the endpoint for you
const users = await bridge.fetch('list users').then(r => r.json());
```

### 4. Open the dashboard

```bash
cd dashboard
npm run dev
# Dashboard at http://localhost:5173
```

---

## API Key Configuration

AutoBridge uses Claude for LLM synthesis when convention matching fails.
Keys are resolved in this order:

1. **Per-request** — passed directly in the SDK call
2. **bridge.config.ts** — `llmApiKey` field
3. **Environment variable** — `AUTOBRIDGE_ANTHROPIC_KEY` or `ANTHROPIC_API_KEY`
4. **Dashboard** — saved in the Keys tab (encrypted at rest)
5. **Convention-only mode** — if no key is found, LLM synthesis is skipped

```bash
# Simplest setup
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## Contract Lifecycle

```
Intent declared → Convention match? → YES → Active contract
                                   → NO  → LLM synthesis
                                             → Confidence ≥ 0.85 → Auto-approved
                                             → Confidence < 0.85 → Pending approval (dashboard)
                                             → No match → Unresolved (retried when new backends register)
```

---

## Stack Support

| Language | Framework | Status |
|---|---|---|
| Python | Flask | ✅ |
| Python | FastAPI | ✅ |
| Python | Django | ✅ |
| Python | Bottle | ✅ |
| TypeScript | Express | ✅ |
| TypeScript | Fastify | ✅ |
| TypeScript | Next.js | ✅ |
| Go | Any | 🔜 |
| Ruby | Rails | 🔜 |

---

## Project Structure

```
autobridge/
├── core/           # Bridge server (TypeScript/Node.js)
│   └── src/
│       ├── manifest/    # Neutral schema types
│       ├── resolver/    # Convention matching
│       ├── synthesizer/ # LLM synthesis
│       ├── proxy/       # Request forwarding
│       ├── store/       # SQLite contract store
│       ├── security/    # Key encryption
│       └── server.ts    # Fastify server
├── sdk-python/     # Python SDK (pip install autobridge-sdk)
├── sdk-ts/         # TypeScript SDK (npm install @autobridge/sdk)
├── dashboard/      # React management dashboard
├── examples/
│   ├── python-flask/
│   └── react-frontend/
└── bridge.config.ts
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key for LLM synthesis |
| `AUTOBRIDGE_ANTHROPIC_KEY` | AutoBridge-specific key (takes priority) |
| `AUTOBRIDGE_ENCRYPTION_SECRET` | Secret for key encryption at rest (change in prod!) |
| `AUTOBRIDGE_PORT` | Bridge server port (default: 7331) |
| `AUTOBRIDGE_DB_PATH` | SQLite database path |
