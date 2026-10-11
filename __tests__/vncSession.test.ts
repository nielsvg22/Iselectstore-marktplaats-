import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VNC_SESSION_TTL_MS,
  _debugPendingSessionCount,
  _debugResetVncSessions,
  consumeVncSessionToken,
  createVncSessionToken,
} from "@/lib/marktplaats/browserTest/vncSession";

/**
 * Covers the token mechanism only (generation, single-use, expiry) — the
 * actual noVNC/websockify WebSocket proxy (server.js) needs a real VNC
 * server to meaningfully test and is out of scope for a unit test; see the
 * implementation report for how that half was verified instead.
 */
describe("vnc-sessie tokens", () => {
  beforeEach(() => {
    _debugResetVncSessions();
  });

  afterEach(() => {
    _debugResetVncSessions();
    vi.useRealTimers();
  });

  it("geeft een ondoorzichtig, uniek token per aanroep", () => {
    const a = createVncSessionToken("geheim-wachtwoord");
    const b = createVncSessionToken("geheim-wachtwoord");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("geheim-wachtwoord");
  });

  it("levert het gekoppelde wachtwoord bij een geldig token", () => {
    const token = createVncSessionToken("super-secret");
    expect(consumeVncSessionToken(token)).toBe("super-secret");
  });

  it("is eenmalig: een tweede keer inwisselen faalt", () => {
    const token = createVncSessionToken("super-secret");
    expect(consumeVncSessionToken(token)).toBe("super-secret");
    expect(consumeVncSessionToken(token)).toBeNull();
  });

  it("verwerpt een onbekend token", () => {
    expect(consumeVncSessionToken("niet-bestaand-token")).toBeNull();
  });

  it("verloopt na de TTL, ook als het nooit werd ingewisseld", () => {
    vi.useFakeTimers();
    const token = createVncSessionToken("super-secret");
    vi.advanceTimersByTime(VNC_SESSION_TTL_MS + 1);
    expect(consumeVncSessionToken(token)).toBeNull();
  });

  it("blijft geldig net binnen de TTL", () => {
    vi.useFakeTimers();
    const token = createVncSessionToken("super-secret");
    vi.advanceTimersByTime(VNC_SESSION_TTL_MS - 1);
    expect(consumeVncSessionToken(token)).toBe("super-secret");
  });

  it("ruimt verlopen tokens op zodra er een nieuw token wordt aangemaakt", () => {
    vi.useFakeTimers();
    createVncSessionToken("a", 10);
    createVncSessionToken("b", 10);
    expect(_debugPendingSessionCount()).toBe(2);
    vi.advanceTimersByTime(20);
    createVncSessionToken("c", 10_000);
    // De twee verlopen tokens zijn opgeruimd; alleen het verse token "c" blijft over.
    expect(_debugPendingSessionCount()).toBe(1);
  });

  it("consumeren van een token dat nooit heeft bestaan laat de store ongemoeid", () => {
    createVncSessionToken("a");
    expect(_debugPendingSessionCount()).toBe(1);
    consumeVncSessionToken("onbekend");
    expect(_debugPendingSessionCount()).toBe(1);
  });
});
