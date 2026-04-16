/**
 * Copyright (c) 2026 CK Scrivner, Inc. All rights reserved.
 * Proprietary and confidential. Unauthorized use is prohibited.
 */

import { TtlCache } from "./cache.js";
import { checkConfig, resolveConfig } from "./config.js";
import type { BudgetStatus } from "./types.js";

// Module-level cache. One per process / one per worker. Acceptable at TCTS
// scale. If services ever run very wide horizontal scale we can move this
// to a shared backend, but the 5-min TTL + soft-fail keeps the blast
// radius of being slightly stale completely fine.
const cache = new TtlCache<string, BudgetStatus>(5 * 60 * 1000);

/**
 * Pre-call budget check. Returns whether the caller is within budget for
 * the given service, with a 5-minute local cache so the common case is a
 * zero-network-cost lookup.
 *
 * Contract:
 *   - Never throws.
 *   - Soft-fails to `{ allowed: true, softFailed: true }` when Mission
 *     Control is unreachable, the API key is wrong, or any other error
 *     keeps us from getting a definitive answer. This is deliberate —
 *     telemetry outages MUST NOT break AI calls.
 *
 * Services that want stricter behavior can inspect `softFailed` and
 * treat it as "we don't know" (e.g., fail-closed under specific conditions).
 *
 * Cache key is just the service name. The cached value is the full
 * BudgetStatus so repeated calls within the TTL return the same answer
 * consistently.
 */
export async function checkBudget(service: string): Promise<BudgetStatus> {
  const cfg = resolveConfig();
  const skipReason = checkConfig(cfg);
  if (skipReason) {
    return { allowed: true, softFailed: true, reason: skipReason, service };
  }

  // Cache re-TTLs on each real hit, matching the cfg TTL in case it was
  // changed mid-process (e.g., tests).
  const cached = cache.get(service);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(
      `${cfg.baseUrl}/api/guardrails/${encodeURIComponent(service)}`,
      {
        method: "GET",
        headers: { "x-api-key": cfg.apiKey },
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      // Treat 4xx/5xx as "we don't know" and soft-fail open.
      return {
        allowed: true,
        softFailed: true,
        reason: `HTTP ${res.status} ${res.statusText}`,
        service,
      };
    }
    const body = (await res.json().catch(() => null)) as BudgetRow | null;
    const decision = interpret(body, service);
    cache.set(service, decision, cfg.budgetCacheTtlMs);
    return decision;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { allowed: true, softFailed: true, reason: msg, service };
  } finally {
    clearTimeout(timer);
  }
}

/** Test / ops helper — clears the budget cache. */
export function resetBudgetCache(): void {
  cache.clear();
}

// ------------------------------------------------------------------
// Interpret MC's guardrails response into a BudgetStatus.
// ------------------------------------------------------------------

interface BudgetRow {
  service?: string;
  enabled?: boolean;
  max_tokens_per_request?: number | null;
  daily_token_budget?: number | null;
  monthly_token_budget?: number | null;
  rate_limit_rpm?: number | null;
  // MC-computed usage for this service, populated by the service-facing endpoint
  used_today?: number | null;
  used_this_month?: number | null;
}

function interpret(row: BudgetRow | null, service: string): BudgetStatus {
  if (!row || row.enabled === false) {
    // No config or explicitly disabled = no ceiling. Allow.
    return { allowed: true, service, usedPct: 0 };
  }

  const dailyLimit = row.daily_token_budget ?? null;
  const dailyUsed = row.used_today ?? 0;
  if (dailyLimit && dailyUsed >= dailyLimit) {
    return {
      allowed: false,
      service,
      reason: `daily token budget exceeded (${dailyUsed} / ${dailyLimit})`,
      usedPct: dailyLimit > 0 ? dailyUsed / dailyLimit : 1,
    };
  }

  const monthlyLimit = row.monthly_token_budget ?? null;
  const monthlyUsed = row.used_this_month ?? 0;
  if (monthlyLimit && monthlyUsed >= monthlyLimit) {
    return {
      allowed: false,
      service,
      reason: `monthly token budget exceeded (${monthlyUsed} / ${monthlyLimit})`,
      usedPct: monthlyLimit > 0 ? monthlyUsed / monthlyLimit : 1,
    };
  }

  // Report the tighter of the two percentages so dashboards reflect the
  // closer-to-exhaustion budget.
  const dailyPct = dailyLimit && dailyLimit > 0 ? dailyUsed / dailyLimit : 0;
  const monthlyPct = monthlyLimit && monthlyLimit > 0 ? monthlyUsed / monthlyLimit : 0;

  return {
    allowed: true,
    service,
    usedPct: Math.max(dailyPct, monthlyPct),
  };
}
