import { describe, expect, it } from "vitest";
import { resolveUnit } from "./areas";
import type { Meta } from "./types";

const meta = {
  tract_geoids: ["36081045400", "36061000100"],
  tract_labels: ["454", "1"],
  tract_nta: [1, 0],
  tract_boro: [1, 0],
  ntas: [
    { i: 0, code: "MN0191", name: "The Battery", boro: "1", type: "9" },
    { i: 1, code: "QN0401", name: "Elmhurst", boro: "4", type: "0" },
  ],
  boroughs: [
    { i: 0, code: "1", name: "Manhattan" },
    { i: 1, code: "4", name: "Queens" },
  ],
} as unknown as Meta;

describe("resolveUnit", () => {
  it("resolves a tract with its NTA and borough parents", () => {
    const r = resolveUnit(meta, { kind: "tract", id: "36081045400" })!;
    expect(r.index).toBe(0);
    expect(r.name).toBe("Tract 454, Queens");
    expect(r.parents).toEqual([{ kind: "nta", id: "QN0401" }, { kind: "boro", id: "4" }]);
  });
  it("resolves NTA and borough", () => {
    expect(resolveUnit(meta, { kind: "nta", id: "QN0401" })!.parents).toEqual([{ kind: "boro", id: "4" }]);
    expect(resolveUnit(meta, { kind: "boro", id: "1" })!.name).toBe("Manhattan");
  });
  it("returns null for unknown ids", () => {
    expect(resolveUnit(meta, { kind: "nta", id: "XX9999" })).toBeNull();
  });
});
