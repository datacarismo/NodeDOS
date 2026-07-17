import { describe, it, expect } from "vitest";
import { secretsMatch, constantTimeEqual } from "./auth";

describe("secretsMatch", () => {
  it("accepts equal secrets", () => {
    expect(secretsMatch("hunter2", "hunter2")).toBe(true);
  });

  it("rejects different secrets of the same length", () => {
    expect(secretsMatch("hunter2", "hunter3")).toBe(false);
  });

  it("rejects secrets of different lengths", () => {
    expect(secretsMatch("hunter", "hunter2")).toBe(false);
    expect(secretsMatch("hunter2longer", "hunter2")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(secretsMatch("", "")).toBe(true);
    expect(secretsMatch("", "x")).toBe(false);
    expect(secretsMatch("x", "")).toBe(false);
  });
});

// The pure-JS path used when node:crypto is unavailable (e.g. the ISO's
// Node.js is built without OpenSSL). Must behave identically.
describe("constantTimeEqual fallback", () => {
  it("accepts equal secrets", () => {
    expect(constantTimeEqual("hunter2", "hunter2")).toBe(true);
  });

  it("rejects different secrets of the same length", () => {
    expect(constantTimeEqual("hunter2", "hunter3")).toBe(false);
  });

  it("rejects prefixes and different lengths", () => {
    expect(constantTimeEqual("hunter", "hunter2")).toBe(false);
    expect(constantTimeEqual("hunter2", "hunter")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("", "x")).toBe(false);
  });

  it("handles multi-byte UTF-8", () => {
    expect(constantTimeEqual("pässwörd", "pässwörd")).toBe(true);
    expect(constantTimeEqual("pässwörd", "password")).toBe(false);
  });
});
