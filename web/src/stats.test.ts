import { describe, expect, it } from "vitest";
import { areaValue, classify, forTracts, weightedSum, type Rules } from "./stats";
import { STATE } from "./types";

const R: Rules = { z: 1.645, cv_reliable_max: 0.3, cv_caution_max: 0.6, min_denominator: 50, min_city_count: 200 };

describe("client stats parity with the pipeline", () => {
  it("classifies the same planted cases as test_stats.py", () => {
    const cases: [number | null, number, number, number][] = [
      [1000, 100, 5000, STATE.reliable],
      [100, 80, 5000, STATE.caution],
      [30, 60, 5000, STATE.suppressed],
      [0, 15, 5000, STATE.zero],
      [null, 10, 5000, STATE.unavailable],
      [10, 5, 20, STATE.suppressed],
      [500, 50, 0, STATE.unavailable],
    ];
    for (const [e, m, d, want] of cases) expect(classify(e, m, d, R)).toBe(want);
  });

  it("tract display rules widen only the caution band", () => {
    const r = { ...R, cv_caution_max_tract: 0.8 };
    expect(classify(100, 115, 4000, r)).toBe(STATE.suppressed); // CV 0.70
    expect(classify(100, 115, 4000, forTracts(r))).toBe(STATE.caution);
    expect(classify(100, 150, 4000, forTracts(r))).toBe(STATE.suppressed); // CV 0.91
  });

  it("never reports a noisy small estimate as zero", () => {
    expect([STATE.caution, STATE.suppressed]).toContain(classify(3, 12, 4000, R));
  });

  it("computes LQ against the city share and hides suppressed values", () => {
    expect(areaValue(500, 50, 5000, 0.01, 10000, R).lq).toBeCloseTo(10);
    const s = areaValue(30, 60, 5000, 0.01, 10000, R);
    expect(s.state).toBe(STATE.suppressed);
    expect(s.lq).toBeNull();
    expect(areaValue(50, 5, 100, 0.0001, 60, R).state).toBe(STATE.suppressed); // tiny reference population
  });

  it("weighted sums use only the largest zero-estimate MOE", () => {
    const w = new Map([[0, 1], [1, 1], [2, 0.5]]);
    const r = weightedSum([0, 0, 100], [20, 30, 40], w);
    expect(r.e).toBe(50);
    expect(r.m).toBeCloseTo(Math.sqrt(30 ** 2 + 20 ** 2));
  });
});
