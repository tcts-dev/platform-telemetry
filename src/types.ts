/**
 * Copyright (c) 2026 CK Scrivner, Inc. All rights reserved.
 * Proprietary and confidential. Unauthorized use is prohibited.
 */

/**
 * Payload a TCTS service sends to Mission Control after each AI call.
 *
 * All fields except the estimates are strongly encouraged for later
 * per-tenant cost attribution. `tenant` is the business entity on whose
 * behalf the call was made (e.g., "mac-management", "sunrise-farm-labor"),
 * not the TCTS service itself.
 */
export interface UsageReport {
  /** Tenant (business entity) this call was for. Use the tenant slug. */
  tenant: string;
  /** TCTS service that made the call. e.g., "porter", "sawyer", "montgomery", "tts". */
  service: string;
  /** Upstream provider. e.g., "anthropic", "openai", "elevenlabs". */
  provider: string;
  /** Specific model identifier. e.g., "claude-opus-4.6", "gpt-realtime". */
  model: string;
  /**
   * High-level operation. Helps with per-feature breakdowns.
   * Examples: "chat", "completion", "embedding", "tts", "stt", "realtime".
   */
  operation: string;
  /** Prompt / input tokens. Required. */
  tokensIn: number;
  /** Completion / output tokens. Required. */
  tokensOut: number;
  /**
   * Estimated cost in cents, based on published provider prices.
   * Integer cents to avoid floating-point drift in the aggregator.
   */
  costCents: number;
  /** Wall-clock duration of the provider call, in milliseconds. */
  durationMs?: number;
  /** Optional status tag. "ok" | "error" | "partial" | etc. */
  status?: string;
  /** Optional free-form metadata (kept small — this ends up in JSONB). */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a pre-call budget check.
 *
 * Default is ALWAYS soft-fail: if Mission Control is unreachable, the
 * library returns `{ allowed: true }` so AI calls are not blocked by
 * observability-layer outages.
 */
export interface BudgetStatus {
  /** Whether the caller is within budget. */
  allowed: boolean;
  /** When allowed=false, a human-readable reason to surface in logs. */
  reason?: string;
  /** 0.0 – 1.0+ indicating how close to the budget the service is. */
  usedPct?: number;
  /** Echo of the service queried, for logging. */
  service?: string;
  /** True if the answer came from the local cache instead of a fresh MC call. */
  fromCache?: boolean;
  /**
   * True if MC was unreachable and we're soft-failing. Callers that want
   * stricter behavior can check this flag and treat it as a failure.
   */
  softFailed?: boolean;
}

/**
 * Configuration resolved from env vars at call time. Exported so that
 * callers can inspect the effective config during debugging; not something
 * services should instantiate themselves.
 */
export interface TelemetryConfig {
  /** Mission Control base URL, e.g., "https://mc.tcts.network". */
  baseUrl: string;
  /** Shared API key for service-to-MC auth. */
  apiKey: string;
  /** Hard HTTP timeout for each telemetry request. */
  timeoutMs: number;
  /** TTL for the per-service budget cache. */
  budgetCacheTtlMs: number;
  /** When true, all operations are no-ops. Used for tests / local dev. */
  disabled: boolean;
}
