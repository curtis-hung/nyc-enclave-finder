import { describe, expect, it } from "vitest";
import { lqScale, nice, quantileBreaks, unitColors, ZERO_COLOR, SUPPRESSED_BASE, fmtShare } from "./scales";
import type { LevelValues } from "./types";

describe("scales", () => {
  it("bins LQ with neutral colours below 1 and the ramp above", () => {
    const s = lqScale();
    expect(s.colorOf(0.2)).toBe(s.bins[0].color);
    expect(s.colorOf(0.99)).toBe(s.bins[1].color);
    expect(s.colorOf(1)).toBe(s.bins[2].color);
    expect(s.colorOf(25)).toBe(s.bins[s.bins.length - 1].color);
    expect(s.bins[0].label).toBe("< 0.5");
  });

  it("rounds breaks nicely and dedupes", () => {
    expect(nice(0.0123)).toBe(0.015);
    expect(nice(870)).toBe(1000);
    const b = quantileBreaks([1, 1, 1, 1, 1, 1, 1, 50]);
    expect(new Set(b).size).toBe(b.length);
  });

  it("never colours suppressed/unavailable values like zero or like data", () => {
    const d: LevelValues = { e: [0, 30, null, 500], m: [], s: [0, null, null, 0.1], lq: [0, null, null, 4], st: [4, 2, 3, 0] };
    const c = unitColors(d, "lq", lqScale());
    expect(c[0]).toBe(ZERO_COLOR);
    expect(c[1]).toBe(SUPPRESSED_BASE);
    expect(c[2]).toBe("rgba(0,0,0,0)");
    expect(new Set(c).size).toBe(4);
  });

  it("formats small shares without rounding to zero", () => {
    expect(fmtShare(0.0004)).toBe("0.04%");
    expect(fmtShare(0)).toBe("0%");
    expect(fmtShare(null)).toBe("—");
  });
});
