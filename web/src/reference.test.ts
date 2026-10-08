import { describe, expect, it } from "vitest";
import { withBoroughReference } from "./reference";
import type { DemoBundle, Meta } from "./types";

const meta = {
  tract_boro: [0, 0, 1],
  ntas: [],
  boroughs: [{ i: 0, code: "1", name: "Manhattan" }, { i: 1, code: "4", name: "Queens" }],
} as unknown as Meta;

const demo = {
  tract: { e: [10, 0, 30], m: [1, 1, 1], s: [0.02, 0, 0.06], lq: [2, 0, 6], st: [0, 4, 0] },
  nta: { e: [], m: [], s: [], lq: [], st: [] },
  boro: { e: [], m: [], s: [0.01, 0.03], lq: [], st: [0, 0] },
} as unknown as DemoBundle;

describe("borough reference", () => {
  it("divides by the unit's own borough share", () => {
    const d = withBoroughReference(meta, demo, "tract");
    expect(d.lq[0]).toBeCloseTo(2); // 0.02 / 0.01 (Manhattan)
    expect(d.lq[2]).toBeCloseTo(2); // 0.06 / 0.03 (Queens), not 6 as against the city
    expect(d.lq[1]).toBe(0); // a true zero stays zero
  });
});
