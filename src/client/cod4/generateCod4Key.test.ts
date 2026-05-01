import { describe, expect, it, vi } from "vitest";
import { generateCod4Key } from "./generateCod4Key";

describe("generateCod4Key", () => {
  it("golden: fixed bytes produce deterministic output", () => {
    const fixedBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    vi.spyOn(crypto, "getRandomValues").mockImplementationOnce((arr) => {
      (arr as Uint8Array).set(fixedBytes);
      return arr;
    });
    const key = generateCod4Key();
    expect(key).toBe("0123-4567-89AB-CDEF-397D");
  });

  it("100 random keys all match the canonical format", () => {
    const pattern = /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-F]{4}$/;
    for (let i = 0; i < 100; i++) {
      expect(generateCod4Key()).toMatch(pattern);
    }
  });

  it("does not call fetch during key generation", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    generateCod4Key();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
