/**
 * Copyright (c) 2026 CK Scrivner, Inc. All rights reserved.
 * Proprietary and confidential. Unauthorized use is prohibited.
 */

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { checkBudget, resetBudgetCache } from "./budget.js";

type FetchFn = typeof fetch;
let originalFetch: FetchFn;

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function fakeFetch(response: {
  ok: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
}): FetchFn {
  return (async () =>
    ({
      ok: response.ok,
      status: response.status ?? 200,
      statusText: response.statusText ?? "OK",
      json: async () => response.body ?? {},
      text: async () => JSON.stringify(response.body ?? {}),
    }) as unknown as Response) as FetchFn;
}

describe("checkBudget", () => {
  before(() => {
    originalFetch = globalThis.fetch;
  });

  beforeEach(() => {
    resetBudgetCache();
    setEnv({
      TCTS_MC_URL: "https://mc.example",
      TCTS_MC_API_KEY: "test-key",
      TCTS_TELEMETRY_DISABLED: undefined,
      TCTS_TELEMETRY_TIMEOUT_MS: "5000",
      TCTS_TELEMETRY_BUDGET_TTL_MS: "60000",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("soft-fails open when config is missing", async () => {
    setEnv({ TCTS_MC_URL: undefined });
    const status = await checkBudget("porter");
    assert.equal(status.allowed, true);
    assert.equal(status.softFailed, true);
  });

  it("soft-fails open when telemetry is explicitly disabled", async () => {
    setEnv({ TCTS_TELEMETRY_DISABLED: "true" });
    const status = await checkBudget("porter");
    assert.equal(status.allowed, true);
    assert.equal(status.softFailed, true);
  });

  it("allows when MC returns enabled=false", async () => {
    globalThis.fetch = fakeFetch({ ok: true, body: { service: "porter", enabled: false } });
    const status = await checkBudget("porter");
    assert.equal(status.allowed, true);
    assert.equal(status.softFailed, undefined);
  });

  it("blocks when daily budget is exceeded", async () => {
    globalThis.fetch = fakeFetch({
      ok: true,
      body: {
        service: "porter",
        enabled: true,
        daily_token_budget: 1000,
        used_today: 1500,
      },
    });
    const status = await checkBudget("porter");
    assert.equal(status.allowed, false);
    assert.match(status.reason || "", /daily token budget exceeded/);
  });

  it("blocks when monthly budget is exceeded", async () => {
    globalThis.fetch = fakeFetch({
      ok: true,
      body: {
        service: "porter",
        enabled: true,
        monthly_token_budget: 10000,
        used_this_month: 10001,
      },
    });
    const status = await checkBudget("porter");
    assert.equal(status.allowed, false);
    assert.match(status.reason || "", /monthly token budget exceeded/);
  });

  it("reports usedPct as tighter of daily/monthly", async () => {
    globalThis.fetch = fakeFetch({
      ok: true,
      body: {
        service: "porter",
        enabled: true,
        daily_token_budget: 1000,
        used_today: 500, // 50%
        monthly_token_budget: 10000,
        used_this_month: 9000, // 90%
      },
    });
    const status = await checkBudget("porter");
    assert.equal(status.allowed, true);
    assert.equal(status.usedPct, 0.9);
  });

  it("soft-fails open on HTTP error", async () => {
    globalThis.fetch = fakeFetch({ ok: false, status: 500, statusText: "Internal" });
    const status = await checkBudget("porter");
    assert.equal(status.allowed, true);
    assert.equal(status.softFailed, true);
    assert.match(status.reason || "", /500/);
  });

  it("soft-fails open on network error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("econnrefused");
    }) as FetchFn;
    const status = await checkBudget("porter");
    assert.equal(status.allowed, true);
    assert.equal(status.softFailed, true);
    assert.match(status.reason || "", /econnrefused/);
  });

  it("caches positive results and returns fromCache on repeat", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          service: "porter",
          enabled: true,
          daily_token_budget: 1000,
          used_today: 100,
        }),
        text: async () => "",
      } as unknown as Response;
    }) as FetchFn;

    const first = await checkBudget("porter");
    const second = await checkBudget("porter");
    assert.equal(calls, 1, "should only hit MC once within TTL");
    assert.equal(first.fromCache, undefined);
    assert.equal(second.fromCache, true);
    assert.equal(second.allowed, true);
  });
});
