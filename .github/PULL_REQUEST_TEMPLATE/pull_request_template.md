## What does this change?

<!-- One paragraph summary of what changed and why. Be specific — "fixes bug" is not enough. -->

## How to test it?

<!-- Step-by-step instructions a reviewer can follow to verify this works. -->

1. 
2. 
3. 

## Does this affect the manifest format?

- [ ] Yes — migration path described below
- [ ] No

<!-- If yes, explain what changed in types.ts and how existing contracts/SDKs are affected. -->

## Does this affect other SDKs?

- [ ] Yes — listed below
- [ ] No

<!-- If yes, list which SDKs need updating and whether this PR includes those updates. -->

## Type of change

- [ ] `fix` — bug fix (non-breaking)
- [ ] `feat` — new feature (non-breaking)
- [ ] `feat!` — breaking change
- [ ] `docs` — documentation only
- [ ] `refactor` — no behavior change
- [ ] `test` — tests only
- [ ] `chore` — build, deps, tooling

## Checklist

- [ ] Tests added or updated for the change
- [ ] `cd core && npx tsc --noEmit` passes
- [ ] `cd dashboard && npx vite build` passes
- [ ] No API keys hardcoded, logged, or exposed in any response
- [ ] Failure modes handled gracefully (registration failures don't crash host apps)
- [ ] SDK conformance checklist followed if this touches an SDK
- [ ] `CONTRIBUTING.md` read and followed
