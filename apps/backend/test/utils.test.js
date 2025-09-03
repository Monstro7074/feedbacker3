import { describe, it, expect } from "vitest";
import { clamp01 } from "../lib/utils.js";

describe("clamp01", () => {
  it("clamps below 0", () => {
    expect(clamp01(-5)).toBe(0);
  });
  it("clamps above 1", () => {
    expect(clamp01(5)).toBe(1);
  });
  it("passes through inside range", () => {
    expect(clamp01(0.31)).toBe(0.31);
  });
  it("handles NaN", () => {
    expect(clamp01("oops")).toBe(0);
  });
});
