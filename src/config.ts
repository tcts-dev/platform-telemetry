/**
 * Copyright (c) 2026 CK Scrivner, Inc. All rights reserved.
 * Proprietary and confidential. Unauthorized use is prohibited.
 */

import type { TelemetryConfig } from "./types.js";

/**
 * Resolve effective config from process.env on every call. We intentionally
 * DO NOT cache the config at module load — Next.js edge/worker boundaries
 * sometimes execute module init once and then run the actual handler in a
 * different env. Reading env per call costs nothing and is safer.
 *
 * Env vars:
 *   TCTS_MC_URL                    — Mission Control base URL. Required unless disabled.
 *   TCTS_MC_API_KEY                — Shared secret for service→MC auth. Required unless disabled.
 *   TCTS_TELEMETRY_DISABLED        — If "true", all calls are no-ops. For tests + local dev.
 *   TCTS_TELEMETRY_TIMEOUT_MS      — HTTP timeout (default 2000).
 *   TCTS_TELEMETRY_BUDGET_TTL_MS   — Budget cache TTL (default 300000 = 5 min).
 */
export function resolveConfig(): TelemetryConfig {
  const disabled =
    (process.env["TCTS_TELEMETRY_DISABLED"] || "").toLowerCase() === "true";

  const baseUrl = (process.env["TCTS_MC_URL"] || "").replace(/\/+$/, "");
  const apiKey = process.env["TCTS_MC_API_KEY"] || "";

  const timeoutMs = parseIntOrDefault(process.env["TCTS_TELEMETRY_TIMEOUT_MS"], 2000);
  const budgetCacheTtlMs = parseIntOrDefault(
    process.env["TCTS_TELEMETRY_BUDGET_TTL_MS"],
    5 * 60 * 1000,
  );

  return { baseUrl, apiKey, timeoutMs, budgetCacheTtlMs, disabled };
}

function parseIntOrDefault(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Validate that the config is usable for a real HTTP call. Returns `null`
 * when usable, or a human-readable reason when not. Callers use this to
 * decide whether to attempt the network at all.
 */
export function checkConfig(cfg: TelemetryConfig): string | null {
  if (cfg.disabled) return "TCTS_TELEMETRY_DISABLED=true";
  if (!cfg.baseUrl) return "TCTS_MC_URL is not set";
  if (!cfg.apiKey) return "TCTS_MC_API_KEY is not set";
  return null;
}
