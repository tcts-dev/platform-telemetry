/**
 * Copyright (c) 2026 CK Scrivner, Inc. All rights reserved.
 * Proprietary and confidential. Unauthorized use is prohibited.
 */

import { checkConfig, resolveConfig } from "./config.js";
import type { UsageReport } from "./types.js";

/**
 * Fire-and-forget: POSTs the usage report to Mission Control at
 * `${TCTS_MC_URL}/api/platform/usage` with the shared service API key.
 *
 * Contract:
 *   - Never throws. All errors are swallowed (and logged to console.warn).
 *   - Never blocks the caller on the HTTP round-trip. We start the request
 *     and return void immediately; the POST races whatever the caller does
 *     next and completes in the background.
 *   - If config is missing or disabled, the call is a no-op with no network.
 *
 * This is intentional — telemetry is a secondary concern to the AI call
 * that just completed. An MC outage, DNS blip, or bad API key MUST NOT
 * affect the user-facing behavior of Porter / Sawyer / Montgomery / TTS.
 */
export function reportUsage(report: UsageReport): void {
  const cfg = resolveConfig();
  const skipReason = checkConfig(cfg);
  if (skipReason) {
    // Only whisper about missing config once per process to avoid log spam.
    warnOnce(`[platform-telemetry] reportUsage skipped: ${skipReason}`);
    return;
  }

  // Intentionally not awaited. Do NOT return the promise or callers might
  // accidentally await it and block their response.
  void postReport(cfg.baseUrl, cfg.apiKey, cfg.timeoutMs, report).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[platform-telemetry] reportUsage background failure: ${msg}`);
  });
}

async function postReport(
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
  report: UsageReport,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/platform/usage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(report),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Throw so the caller's catch logs a readable message. Importantly,
      // this rejection lives inside the background promise and does not
      // affect the service's own response path.
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------
// One-shot warning dedup. Avoids flooding logs when MC is misconfigured.
// ------------------------------------------------------------------
const warnedMessages = new Set<string>();
function warnOnce(msg: string): void {
  if (warnedMessages.has(msg)) return;
  warnedMessages.add(msg);
  // eslint-disable-next-line no-console
  console.warn(msg);
}

/** Test-only: clear the "warned once" cache. Not exported from index. */
export function _resetWarnedMessages(): void {
  warnedMessages.clear();
}
