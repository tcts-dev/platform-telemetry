/**
 * Copyright (c) 2026 CK Scrivner, Inc. All rights reserved.
 * Proprietary and confidential. Unauthorized use is prohibited.
 */

/**
 * @tcts-dev/platform-telemetry
 *
 * Shared client for TCTS services (Porter, Sawyer, Montgomery, TTS) to:
 *   1. Report AI usage to Mission Control after each provider call
 *      (fire-and-forget, never blocks the caller)
 *   2. Optionally check the service's budget BEFORE expensive calls
 *      (5-min local cache, soft-fails open if MC is unreachable)
 *
 * Design guarantees:
 *   - Telemetry failures NEVER affect user-facing AI behavior.
 *   - No persistent connections, no background timers, no module init
 *     surprises — just two plain functions.
 *   - Config resolved from process.env at call time (Next.js edge-safe).
 *
 * Env vars:
 *   TCTS_MC_URL                  — Mission Control base URL.
 *   TCTS_MC_API_KEY              — Shared secret for service→MC auth.
 *   TCTS_TELEMETRY_DISABLED      — Optional, set "true" to no-op everything.
 *   TCTS_TELEMETRY_TIMEOUT_MS    — Optional HTTP timeout (default 2000).
 *   TCTS_TELEMETRY_BUDGET_TTL_MS — Optional cache TTL (default 5 min).
 */

export { reportUsage } from "./report.js";
export { checkBudget, resetBudgetCache } from "./budget.js";
export type { UsageReport, BudgetStatus, TelemetryConfig } from "./types.js";
