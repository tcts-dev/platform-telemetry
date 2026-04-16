/**
 * Copyright (c) 2026 CK Scrivner, Inc. All rights reserved.
 * Proprietary and confidential. Unauthorized use is prohibited.
 */

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { reportUsage } from "./report.js";
import { _resetWarnedMessages } from "./report.js";

type FetchFn = typeof fetch;
let originalFetch: FetchFn;
let originalWarn: typeof console.warn;

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// Wait for the fire-and-forget promise chain to settle.
// We don't expose the promise; we just give the microtask queue a couple of
// ticks to let the fetch + catch resolve.
async function flushMicrotasks(count = 5): Promise<void> {
  for (let i = 0; i < count; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}

describe("reportUsage", () => {
  before(() => {
    originalFetch = globalThis.fetch;
    originalWarn = console.warn;
  });

  beforeEach(() => {
    _resetWarnedMessages();
    setEnv({
      TCTS_MC_URL: "https://mc.example",
      TCTS_MC_API_KEY: "test-key",
      TCTS_TELEMETRY_DISABLED: undefined,
      TCTS_TELEMETRY_TIMEOUT_MS: "5000",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });

  it("is synchronous — does not return a promise", () => {
    globalThis.fetch = (async () =>
      ({ ok: true, status: 200, statusText: "OK", text: async () => "" }) as unknown as Response) as FetchFn;
    const ret = reportUsage({
      tenant: "mac",
      service: "porter",
      provider: "anthropic",
      model: "claude",
      operation: "chat",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 1,
    });
    assert.equal(ret, undefined);
  });

  it("posts to /api/platform/usage with x-api-key", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      capturedBody = init.body as string;
      return { ok: true, status: 200, statusText: "OK", text: async () => "" } as unknown as Response;
    }) as FetchFn;

    reportUsage({
      tenant: "mac-management",
      service: "porter",
      provider: "anthropic",
      model: "claude-opus-4.6",
      operation: "chat",
      tokensIn: 100,
      tokensOut: 50,
      costCents: 12,
    });
    await flushMicrotasks();

    assert.equal(capturedUrl, "https://mc.example/api/platform/usage");
    assert.equal(capturedHeaders["x-api-key"], "test-key");
    assert.equal(capturedHeaders["content-type"], "application/json");
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.tenant, "mac-management");
    assert.equal(parsed.tokensIn, 100);
  });

  it("no-ops silently when config is missing", async () => {
    setEnv({ TCTS_MC_URL: undefined });
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return { ok: true } as Response;
    }) as FetchFn;

    reportUsage({
      tenant: "x",
      service: "porter",
      provider: "anthropic",
      model: "m",
      operation: "chat",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 1,
    });
    await flushMicrotasks();
    assert.equal(called, false);
  });

  it("no-ops silently when disabled", async () => {
    setEnv({ TCTS_TELEMETRY_DISABLED: "true" });
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return { ok: true } as Response;
    }) as FetchFn;

    reportUsage({
      tenant: "x",
      service: "porter",
      provider: "anthropic",
      model: "m",
      operation: "chat",
      tokensIn: 1,
      tokensOut: 1,
      costCents: 1,
    });
    await flushMicrotasks();
    assert.equal(called, false);
  });

  it("swallows HTTP errors without throwing", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 500,
        statusText: "Internal",
        text: async () => "db is down",
      }) as unknown as Response) as FetchFn;

    // Capture console.warn
    const warnings: string[] = [];
    console.warn = (msg: unknown) => {
      warnings.push(String(msg));
    };

    assert.doesNotThrow(() => {
      reportUsage({
        tenant: "x",
        service: "porter",
        provider: "anthropic",
        model: "m",
        operation: "chat",
        tokensIn: 1,
        tokensOut: 1,
        costCents: 1,
      });
    });
    await flushMicrotasks();
    assert.ok(warnings.some((w) => w.includes("500")), `expected a 500 warning, got ${JSON.stringify(warnings)}`);
  });

  it("swallows network errors without throwing", async () => {
    globalThis.fetch = (async () => {
      throw new Error("dns failure");
    }) as FetchFn;

    const warnings: string[] = [];
    console.warn = (msg: unknown) => {
      warnings.push(String(msg));
    };

    assert.doesNotThrow(() => {
      reportUsage({
        tenant: "x",
        service: "porter",
        provider: "anthropic",
        model: "m",
        operation: "chat",
        tokensIn: 1,
        tokensOut: 1,
        costCents: 1,
      });
    });
    await flushMicrotasks();
    assert.ok(warnings.some((w) => w.includes("dns failure")), `expected a dns warning, got ${JSON.stringify(warnings)}`);
  });
});
