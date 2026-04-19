# @tcts-dev/platform-telemetry

Shared client for TCTS services (Porter, Sawyer, Montgomery, TTS) to report AI usage to Mission Control after each provider call, and optionally check budget before expensive calls.

## Install

Consumed via SHA-pinned `git+https://` in the consumer's `package.json`:

```json
{
  "dependencies": {
    "@tcts-dev/platform-telemetry": "git+https://github.com/tcts-dev/platform-telemetry.git#<commit-sha>"
  }
}
```

Then:

```bash
npm install
```

> **Important:** because this package is consumed directly from `git+https://`, the install must be allowed to run the package's lifecycle scripts (including `prepare`) so the build artifacts are generated. Do **not** install with `--ignore-scripts`, and do not omit the build-time/dev dependencies needed for that step.
Bump the SHA in `package.json` to pick up a new version — `npm` caches git deps aggressively, so "upgrade on next install" won't work without a SHA change. See workspace `CLAUDE.md` → "Shared npm packages under @tcts-dev/*" for the full rationale.

## Usage

```typescript
import { reportUsage, checkBudget } from "@tcts-dev/platform-telemetry";

// Optional: check budget before an expensive call.
// Soft-fails to { allowed: true, softFailed: true } if MC is unreachable.
const { allowed, reason, usedPct } = await checkBudget("porter");
if (!allowed) {
  logger.warn({ reason, usedPct }, "over budget");
  // Default: log and continue (soft enforcement).
  // Strict callers can return early here instead.
}

const response = await anthropic.messages.create({ ... });

// Fire-and-forget. Never blocks, never throws.
reportUsage({
  tenant: "mac-management",
  service: "porter",
  provider: "anthropic",
  model: "claude-opus-4.6",
  operation: "chat",
  tokensIn: response.usage.input_tokens,
  tokensOut: response.usage.output_tokens,
  costCents: estimateCostCents(response.usage, "claude-opus-4.6"),
  durationMs: Date.now() - start,
  status: "ok",
});
```

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `TCTS_MC_URL` | Yes | — | Mission Control base URL, e.g. `https://mc.tcts.network`. |
| `TCTS_MC_API_KEY` | Yes | — | Shared secret for service→MC auth. Stored in AWS Secrets Manager. |
| `TCTS_TELEMETRY_DISABLED` | No | `false` | Set `"true"` to no-op everything — for tests and local dev. |
| `TCTS_TELEMETRY_TIMEOUT_MS` | No | `2000` | HTTP timeout for MC calls. |
| `TCTS_TELEMETRY_BUDGET_TTL_MS` | No | `300000` (5 min) | In-memory cache TTL for `checkBudget`. |

If `TCTS_MC_URL` or `TCTS_MC_API_KEY` is missing, both `reportUsage` and `checkBudget` become no-ops. A single `console.warn` is emitted per process on first use. This makes local dev work without setup while still surfacing misconfiguration in production logs.

## Design guarantees

- **Telemetry never breaks the caller.** `reportUsage` is fire-and-forget and swallows all errors. `checkBudget` never throws; worst case it returns `{ allowed: true, softFailed: true }`.
- **MC outages don't cascade.** A 500 from MC, a DNS blip, an expired API key — none of these affect user-facing AI behavior.
- **Cache is local, per-process, per-instance.** 5-minute TTL. At TCTS scale (one or two tasks per service) this is enough. If we ever need shared caching we'll introduce Redis but not before.
- **No background timers, no module init side effects.** Calls are self-contained. Tests can mock `globalThis.fetch` and swap env vars between runs.
- **Config is resolved per call, not cached.** Safe across Next.js edge/worker boundaries.

## Enforcement model

By deliberate choice, the default is **soft enforcement**:

- `checkBudget` returns `{ allowed: false, reason }` when a service is over its daily or monthly token budget, but services that want to keep serving can ignore this and call the provider anyway.
- The recommended usage is: log the breach, fire an alert (email, Slack), but don't return an error to the end user. Cost containment comes from Mission Control rotating the provider API key when an abuse is happening in real time — not from returning 500s to customers.

Services that want hard enforcement (refuse calls, return an error) can do so by honoring `allowed === false` themselves. The library doesn't enforce policy; it reports status.

## What MC needs on the other side

- `POST /api/platform/usage` — accepts the `UsageReport` JSON, validates `x-api-key` header, inserts into `api_usage_log`.
- `GET /api/guardrails/{service}` — returns the guardrail config row for that service, plus computed `used_today` and `used_this_month` aggregates from `api_usage_log`. Validates `x-api-key`.

See `reference/mission-control-plan.md` in the Botployees workspace for the full architecture.

## Testing locally

```bash
npm install
npm run build
npm test   # runs node:test against src/*.test.ts via tsx
```

Tests mock `globalThis.fetch` — no real network traffic. `TCTS_MC_URL` and `TCTS_MC_API_KEY` are set to dummy values per test.

## Publishing

This package is **not published to any registry**. Services consume it by pinning a specific commit SHA in their `package.json` (see Install section above). To cut a release:

1. Land changes on `main`.
2. In each consumer, update the `"@tcts-dev/platform-telemetry"` entry to the new commit SHA.
3. `npm install` in the consumer.

Same pattern `@tcts-dev/entra-auth` uses. `"private": true` in `package.json` prevents accidental `npm publish` to public npm.
