import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, parse, parseArea, serialize, type ViewState } from "./url";

describe("URL state", () => {
  it("round-trips a full view", () => {
    const v: ViewState = {
      group: "thai",
      dim: "asian",
      metric: "share",
      level: "nta",
      preset: "strict",
      reference: "boro",
      area: { kind: "nta", id: "QN0401" },
      enclaves: false,
      cuisine: "thai",
      conf: "high",
      multi: true,
      restaurant: 1234,
      gaps: true,
      restOverlay: false,
      connectors: false,
      layer: "diversity",
      pinned: { kind: "boro", id: "2" },
      worship: true,
      about: true,
    };
    expect(parse("#" + serialize(v))).toEqual(v);
  });

  it("round-trips a radius focus", () => {
    const v: ViewState = { ...DEFAULT_VIEW, group: "korean", area: { kind: "radius", lat: 40.7476, lon: -73.9867, mi: 0.5 } };
    expect(parse(serialize(v))).toEqual(v);
  });

  it("omits defaults and parses empty hash to defaults", () => {
    expect(serialize(DEFAULT_VIEW)).toBe("");
    expect(parse("")).toEqual(DEFAULT_VIEW);
  });

  it("ignores malformed values", () => {
    const v = parse("#m=bogus&l=boro&a=n:nope");
    expect(v.metric).toBe("lq");
    expect(v.level).toBeNull();
    expect(v.area).toBeNull();
    expect(parseArea("r:1,2,99")).toBeNull(); // radius outside 0.1-3 mi
    expect(parseArea("t:36081045400")).toEqual({ kind: "tract", id: "36081045400" });
    expect(parseArea("b:4")).toEqual({ kind: "boro", id: "4" });
  });
});
