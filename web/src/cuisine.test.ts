import { describe, expect, it } from "vitest";
import { CuisineIndex, cuisineLQs, FLAG, mapsLink, type CuisineFile, type Points } from "./cuisine";

// root(0) -> latin_american(1) -> ecuadorian(2), colombian(3); root -> thai(4); generic_format(5); pizza(6)
const file: CuisineFile = {
  nodes: [
    { id: "root", name: "Any", kind: "generic", parents: [], anc: [], dohmh: [] },
    { id: "latin_american", name: "Latin American", kind: "bucket", parents: [0], anc: [0], dohmh: ["Latin American"] },
    { id: "ecuadorian", name: "Ecuadorian", kind: "cuisine", parents: [1], anc: [0, 1], dohmh: [] },
    { id: "colombian", name: "Colombian", kind: "cuisine", parents: [1], anc: [0, 1], dohmh: [] },
    { id: "thai", name: "Thai", kind: "cuisine", parents: [0], anc: [0], dohmh: ["Thai"] },
    { id: "generic_format", name: "Format", kind: "generic", parents: [0], anc: [0], dohmh: ["Coffee/Tea"] },
    { id: "pizza", name: "Pizza", kind: "food_type", parents: [0], anc: [0], dohmh: ["Pizza"] },
  ],
  exact_owner: {},
  tag_confidence: "medium",
};
const A = FLAG.analysis;
// 0: Latin American tagged Ecuadorian(medium) + Colombian(high); 1: Thai; 2: coffee shop tagged thai (low)
// 3: Latin American untagged; 4: multi-location Thai (not in analysis population)
const pts: Points = {
  n: 5,
  lon: [0, 0, 0, 0, 0],
  lat: [0, 0, 0, 0, 0],
  tract: [0, 0, 0, 0, 0],
  primary: [1, 4, 5, 1, 4],
  flags: [A, A, A, A, FLAG.multi],
  tags: { "0": [[2, 2], [3, 3]], "2": [[4, 1]] },
};
const ix = new CuisineIndex(file);

describe("cuisine filtering rule", () => {
  it("matches by primary, by tag, or by ancestor", () => {
    expect(ix.matchKind(pts, 0, 1, 2)).toBe(1); // Latin American primary
    expect(ix.matchKind(pts, 0, 2, 2)).toBe(2); // Ecuadorian via tag
    expect(ix.matchKind(pts, 0, 3, 3)).toBe(2); // Colombian tag is high
    expect(ix.matchKind(pts, 0, 2, 3)).toBe(0); // Ecuadorian tag is only medium
    expect(ix.matchKind(pts, 3, 2, 1)).toBe(0); // untagged Latin American is not Ecuadorian
  });

  it("generic primaries never match a cuisine, but their tags can", () => {
    expect(ix.matchKind(pts, 2, 4, 2)).toBe(0); // low tag below the medium floor
    expect(ix.matchKind(pts, 2, 4, 1)).toBe(2);
  });

  it("a multi-tag restaurant counts once per cuisine and once in the total", () => {
    const c = ix.closure(pts, 0, 2);
    expect([...c].sort()).toEqual([1, 2, 3]);
    const lqs = cuisineLQs(ix, pts, [0, 1], 2, 1);
    const ec = lqs.find((x) => x.node === 2)!;
    expect(ec.total).toBe(2); // restaurants, not tags
    expect(ec.count).toBe(1);
  });

  it("excludes restaurants outside the analysis population from cuisine LQ", () => {
    const lqs = cuisineLQs(ix, pts, [4], 2, 1);
    expect(lqs).toEqual([]);
  });

  it("builds a Google Maps search link without any API key", () => {
    const url = mapsLink({ name: "Thai Son", address: "89 Baxter St", boro: "Manhattan", zip: "10013" } as never);
    expect(url).toBe("https://www.google.com/maps/search/?api=1&query=Thai%20Son%2089%20Baxter%20St%20Manhattan%20NY%2010013");
  });
});
