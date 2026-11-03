import { describe, expect, it } from "vitest";
import { CuisineIndex, type CuisineFile, type Points } from "./cuisine";
import { distanceMi, distToGeomMi, findCandidates, matchStrength, sortSuggestions } from "./suggest";

// root(0) -> asian(1, bucket) -> thai(2); root -> pizza(3); root -> coffee(4, generic)
const file: CuisineFile = {
  nodes: [
    { id: "root", name: "All", kind: "generic", parents: [], anc: [], dohmh: [] },
    { id: "asian", name: "Asian", kind: "bucket", parents: [0], anc: [0], dohmh: [] },
    { id: "thai", name: "Thai", kind: "cuisine", parents: [1], anc: [0, 1], dohmh: [] },
    { id: "pizza", name: "Pizza", kind: "cuisine", parents: [0], anc: [0], dohmh: [] },
    { id: "coffee", name: "Coffee", kind: "generic", parents: [0], anc: [0], dohmh: [] },
  ],
  exact_owner: {},
  tag_confidence: "medium",
};
const ix = new CuisineIndex(file);
const A = 4; // FLAG.analysis
const M = 1; // FLAG.multi

// five restaurants along a line of latitude in Queens, ~0.1 mi apart
const pts: Points = {
  n: 5,
  lat: [4074000, 4074000, 4074000, 4074000, 4074000],
  lon: [-7388000, -7387800, -7387600, -7387400, -7387200],
  tract: [0, 0, 0, 0, 0],
  primary: [2, 1, 3, 4, 2], // thai, asian, pizza, coffee(generic), thai
  flags: [A, A, A, A, M],
  tags: { "1": [[2, 3]], "2": [[2, 2]], "3": [[2, 1]] }, // asian->thai high; pizza->thai medium (a conflict would never be here); coffee->thai low
};
const origin = { lat: 40.74, lon: -73.88 };

describe("find food", () => {
  it("ranks match strength: DOHMH label > high tag > medium > low", () => {
    const t = ix.byId.get("thai")!;
    expect([0, 1, 2, 3].map((i) => matchStrength(ix, pts, i, t, 1))).toEqual([4, 3, 2, 1]);
    expect(matchStrength(ix, pts, 3, t, 2)).toBe(0); // low tag ignored at the medium floor
  });

  it("drops multi-location places unless shown, and applies the radius", () => {
    const base = { ix, pts, target: ix.byId.get("thai")!, floor: 1, pool: [0, 1, 2, 3, 4], origin };
    expect(findCandidates({ ...base, multi: false }).map((s) => s.i)).toEqual([0, 1, 2, 3]);
    expect(findCandidates({ ...base, multi: true }).map((s) => s.i)).toEqual([0, 1, 2, 3, 4]);
    expect(findCandidates({ ...base, multi: false, maxMi: 0.15 }).map((s) => s.i)).toEqual([0, 1]);
  });

  it("sorts by distance or by confidence, and shuffles reproducibly", () => {
    const list = findCandidates({ ix, pts, target: ix.byId.get("thai")!, floor: 1, multi: false, pool: [3, 2, 1, 0], origin: { lat: 40.74, lon: -73.874 } });
    expect(sortSuggestions(list, "distance").map((s) => s.i)).toEqual([3, 2, 1, 0]);
    expect(sortSuggestions(list, "confidence").map((s) => s.i)).toEqual([0, 1, 2, 3]);
    const a = sortSuggestions(list, "shuffle", 7).map((s) => s.i);
    expect(sortSuggestions(list, "shuffle", 7).map((s) => s.i)).toEqual(a);
    expect([...a].sort()).toEqual([0, 1, 2, 3]);
  });

  it("community option keeps only restaurants near the enclave polygons", () => {
    // a small square around restaurant 0
    const sq: GeoJSON.Polygon = { type: "Polygon", coordinates: [[[-73.8805, 40.7395], [-73.8795, 40.7395], [-73.8795, 40.7405], [-73.8805, 40.7405], [-73.8805, 40.7395]]] };
    const list = findCandidates({ ix, pts, target: null, floor: 1, multi: false, pool: [0, 1, 2, 3], origin: null, enclaves: [sq], enclaveMi: 0.15, enclaveOnly: true });
    expect(list.map((s) => [s.i, Math.round((s.enclaveDist ?? -1) * 100) / 100])).toEqual([[0, 0], [1, 0.08]]);
  });

  it("every other mode tags restaurants near an enclave without dropping the rest", () => {
    const sq: GeoJSON.Polygon = { type: "Polygon", coordinates: [[[-73.8805, 40.7395], [-73.8795, 40.7395], [-73.8795, 40.7405], [-73.8805, 40.7405], [-73.8805, 40.7395]]] };
    const list = findCandidates({ ix, pts, target: null, floor: 1, multi: false, pool: [0, 1, 2, 3], origin: null, enclaves: [sq], enclaveMi: 0.15 });
    expect(list.map((s) => s.i)).toEqual([0, 1, 2, 3]);
    expect(list.map((s) => s.enclaveDist === undefined ? null : Math.round(s.enclaveDist * 100) / 100)).toEqual([0, 0.08, null, null]);
  });

  it("measures distances in miles", () => {
    expect(distanceMi({ lat: 40.74, lon: -73.88 }, { lat: 40.75, lon: -73.88 })).toBeCloseTo(0.69, 2);
    const sq: GeoJSON.Polygon = { type: "Polygon", coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] };
    expect(distToGeomMi({ lat: 0.005, lon: 0.005 }, sq)).toBe(0);
    expect(distToGeomMi({ lat: 0.02, lon: 0.005 }, sq)).toBeCloseTo(0.69, 2);
  });
});
