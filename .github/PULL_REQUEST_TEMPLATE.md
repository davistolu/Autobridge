## What this does

<!-- A clear, concise description of the change. What problem does it solve or what does it add? -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] New SDK / SDK update
- [ ] Documentation
- [ ] Refactor / chore

## Testing

<!-- How did you verify this works? List the steps you took. -->

## Checklist

- [ ] Base branch is `preview` (not `main`)
- [ ] `cd core && npx tsc --noEmit` passes
- [ ] `cd dashboard && npx vite build` passes  
- [ ] No `autobridge` references remain (run: `grep -rin "autobridge" --include="*.ts" --include="*.py" --include="*.go" --include="*.rb" --include="*.php" --include="*.md" . | grep -v node_modules | grep -v dist`)
- [ ] Example added/updated in `examples/` (if new SDK)
- [ ] README updated (if user-facing change)

## Related issues

<!-- Closes #123 -->
