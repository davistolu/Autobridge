# Contributing to WireBridge

Thanks for taking the time to contribute. WireBridge is an open project and contributions of all kinds are welcome — bug fixes, new SDK support, documentation improvements, and feature work.

---

## Branches

The repository has two permanent branches:

| Branch | Purpose |
|---|---|
| `preview` | Active development. All PRs target this branch. |
| `main` | Stable, released code. Only merged from `preview` when a version is ready to ship. |

**You should never open a PR directly against `main`.** All contributions go to `preview` first. The maintainers promote `preview` → `main` as part of the release process.

```
your-feature-branch  →  preview  →  (release)  →  main
```

---

## Before you start

**Bug fixes and small changes** — just open a PR. No issue needed.

**New features or significant changes** — open an issue first. Describe what you want to build and wait for a thumbs-up before coding. This avoids wasted work.

**New SDK support** — check for an existing tracking issue for that language. If none exists, open one. New SDKs must implement the full manifest format. Read an existing SDK first — Python and TypeScript are the cleanest references.

---

## Setup

### Prerequisites

- Node.js 18+
- Python 3.9+ (for Python SDK work)
- Go 1.21+ (for Go SDK work)
- Ruby 3.0+ (for Ruby SDK work)
- PHP 8.1+ with Composer (for Laravel SDK work)

### Clone and install

```bash
git clone https://github.com/davistolu/autobridge
cd wirebridge

# Core + dashboard
cd core && npm install && cd ..
cd dashboard && npm install && cd ..

# Python SDK (optional)
cd sdk-python && pip install -e ".[flask,fastapi]" && cd ..
```

### Run locally

```bash
# Terminal 1 — bridge server
cd core && npm run dev
# http://localhost:7331

# Terminal 2 — dashboard
cd dashboard && npm run dev
# http://localhost:5173
```

---

## Making changes

### 1. Fork and branch off `preview`

```bash
git clone https://github.com/<your-username>/autobridge
cd wirebridge
git checkout preview
git checkout -b feat/my-feature
```

Branch naming:

| Prefix | Use for |
|---|---|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `sdk/` | New or updated SDK |
| `chore/` | Tooling, deps, CI |
| `refactor/` | Behaviour-neutral code changes |

### 2. Write focused commits

One logical change per commit. Imperative style: `fix convention resolver tag scoring`, not `fixed stuff`.

### 3. Verify before pushing

```bash
# If you touched core TypeScript
cd core && npx tsc --noEmit

# If you touched the dashboard
cd dashboard && npx vite build

# Check for stale name references
grep -rin "autobridge" \
  --include="*.ts" --include="*.tsx" --include="*.jsx" \
  --include="*.py" --include="*.go" --include="*.rb" \
  --include="*.php" --include="*.md" --include="*.json" \
  . | grep -v node_modules | grep -v dist
# Should return nothing
```

### 4. Open a PR targeting `preview`

Set the base branch to `preview`. PRs targeting `main` will be redirected.

---

## PR checklist

- [ ] Base branch is `preview`
- [ ] `npx tsc --noEmit` passes (if core was touched)
- [ ] `npx vite build` passes (if dashboard was touched)
- [ ] No `autobridge` references remain anywhere
- [ ] Example added/updated in `examples/` if adding a new SDK
- [ ] README updated if something user-facing changed

---

## Adding a new SDK

Any language that can make HTTP requests can have a WireBridge SDK.

### Required: backend registration

POST to `http://localhost:7331/registry/backend`:

```json
{
  "manifest": {
    "serviceId": "svc-abc123",
    "serviceName": "my-service",
    "version": "1.0.0",
    "baseUrl": "http://localhost:8000",
    "stack": "language-framework",
    "capabilities": [
      {
        "id": "svc-abc123./api/users",
        "name": "list users",
        "handler": "/api/users",
        "method": "GET",
        "tags": ["users", "read"],
        "input": {},
        "output": {
          "users": {
            "type": "array",
            "required": true,
            "items": { "type": "object", "required": true }
          }
        }
      }
    ],
    "registeredAt": "2025-01-01T00:00:00Z"
  }
}
```

### Required: heartbeat

POST to `/registry/heartbeat` with `{ "serviceId": "<id>" }` every 30 seconds in a background thread. If the bridge doesn't receive a heartbeat for 90 seconds, it marks the service offline and drifts its contracts.

### Required: schema helpers

Expose typed helpers that produce WireBridge field schema objects. See `sdk-python/wirebridge/__init__.py` for the reference implementation (`string_field()`, `array_field()`, `object_field()`, etc.).

### Required: example

Add `examples/<language>-<framework>/` with a realistic working example. Follow the structure of existing examples.

### Required: README update

Add a row to the Stack Support table and a code block in the Quick Start → Register your backend section.

---

## Reporting bugs

Open a GitHub issue with:

1. What you expected
2. What happened instead
3. Steps to reproduce (minimal)
4. Stack — language, framework, Node.js version, OS
5. Bridge server log output

---

## Questions

Open a GitHub Discussion or comment on the relevant issue.
