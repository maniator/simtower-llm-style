import { describe, it, expect } from "vitest";
import { looksLikeTWR, parseTWR, LegacyNotYetSupported } from "../storage/twrImport";

describe("Legacy .TWR import foundation", () => {
  it("recognises .twr files by name", () => {
    expect(looksLikeTWR("MYTOWER.TWR")).toBe(true);
    expect(looksLikeTWR("tower.twr")).toBe(true);
    expect(looksLikeTWR("save.json")).toBe(false);
  });

  it("recognises large non-JSON buffers as legacy towers", () => {
    const big = new Uint8Array(3000);
    big[0] = 0x00; // not '{' or '['
    expect(looksLikeTWR("unknown.dat", big)).toBe(true);
    const json = new Uint8Array(3000);
    json[0] = 0x7b; // '{'
    expect(looksLikeTWR("unknown.dat", json)).toBe(false);
  });

  it("recognises a plausible .TWR but defers full conversion to v2", () => {
    const buf = new Uint8Array(4096).buffer;
    expect(() => parseTWR(buf)).toThrow(LegacyNotYetSupported);
  });

  it("rejects a too-small file as not a tower", () => {
    expect(() => parseTWR(new Uint8Array(4).buffer)).toThrow();
  });
});
