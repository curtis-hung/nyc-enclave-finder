import { describe, expect, it } from "vitest";
import { addCells, districtOf, ratio, type DiasporaIndex } from "./diaspora";

const cellOf = (n: number, est: number, delta: number) => [n, est, ...Array.from({ length: 80 }, (_, k) => (k % 2 ? delta : -delta))];

describe("diaspora detail (client parity with the pipeline)", () => {
  it("hides thin values instead of returning zero", () => {
    expect(ratio(cellOf(5, 50, 1), cellOf(100, 1000, 1), 0.3, 30)).toBeNull();
    expect(ratio(cellOf(0, 0, 0), cellOf(100, 1000, 1), 0.3, 1)).toBeNull();
  });

  it("computes a replicate SE like the pipeline", () => {
    // num 500 (reps ±10), den 1000 (reps fixed): p_r = 0.49/0.51 -> SE = sqrt(4/80 * 80 * 0.01^2) = 0.02
    const num = cellOf(200, 500, 10);
    const den = [400, 1000, ...Array(80).fill(0)];
    const r = ratio(num, den, 0.3, 30)!;
    expect(r[0]).toBeCloseTo(0.5);
    expect(r[1]).toBeCloseTo(0.02);
  });

  it("combines PUMAs by summing cells, not averaging percentages", () => {
    const a = addCells([cellOf(50, 10, 0), cellOf(500, 900, 0)])!;
    const d = addCells([cellOf(100, 100, 0), cellOf(1000, 1000, 0)])!;
    expect(ratio(a, d, 1, 1)![0]).toBeCloseTo(910 / 1100);
  });

  it("the district is the PUMAs holding >= 10% of the area's residents, named in the label", () => {
    const ix = {
      tract_puma: [0, 0, 1, 2],
      pumas: [{ code: "04101", label: "Queens: A" }, { code: "04102", label: "Queens: B" }, { code: "04103", label: "Queens: C" }],
      rules: { district_min_pop_share: 0.1 },
    } as unknown as DiasporaIndex;
    const d = districtOf(ix, new Map([[0, 1], [1, 1], [2, 1], [3, 0.05]]), [1000, 1000, 800, 1000])!;
    expect(d.pumas).toEqual([0, 1]); // PUMA C holds only 50 of 2,850 residents
    expect(d.label).toBe("Queens: A + Queens: B");
  });
});
