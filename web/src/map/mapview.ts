// Imperative MapLibre wrapper: basemap, choropleth with data-state textures, enclaves.

import * as maplibregl from "maplibre-gl";
import { type FilterSpecification, type GeoJSONSource, type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

maplibregl.setWorkerUrl(workerUrl);
import { CLUSTER_COLOR, ENCLAVE_COLOR } from "../scales";
import { geoURL } from "../data";

const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
const NYC_BOUNDS: [[number, number], [number, number]] = [[-74.26, 40.49], [-73.69, 40.92]];

const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#f4f3ef" } }],
};

export type UnitLevel = "tract" | "nta";

export interface HoverInfo {
  level: UnitLevel | "boro";
  index: number;
  props: Record<string, unknown>;
  point: { x: number; y: number };
}

function pattern(kind: "hatch" | "dots" | "cross", ink: string): ImageData {
  const s = 8;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = ctx.fillStyle = ink;
  ctx.lineWidth = 1.2;
  if (kind === "hatch") {
    ctx.beginPath();
    ctx.moveTo(0, s);
    ctx.lineTo(s, 0);
    ctx.moveTo(-2, 2);
    ctx.lineTo(2, -2);
    ctx.moveTo(s - 2, s + 2);
    ctx.lineTo(s + 2, s - 2);
    ctx.stroke();
  } else if (kind === "cross") {
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s, s);
    ctx.moveTo(0, s);
    ctx.lineTo(s, 0);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(2, 2, 1.1, 0, Math.PI * 2);
    ctx.arc(6, 6, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  return ctx.getImageData(0, 0, s, s);
}

/** Keep the map's focus clear of the control panel (left on desktop, bottom sheet on phones). */
export function panelPadding(): { left: number; bottom: number } {
  const panel = document.querySelector(".panel") as HTMLElement | null;
  if (window.innerWidth >= 768) return { left: (panel?.offsetWidth ?? 380) + 24, bottom: 20 };
  return { left: 10, bottom: Math.min((panel?.offsetHeight ?? 0) + 10, window.innerHeight * 0.6) };
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const NONE: FilterSpecification = ["==", ["get", "i"], -1];

export class MapView {
  readonly map: MLMap;
  private ready: Promise<void>;
  private beforeId: string | undefined;
  private hoverCb: ((h: HoverInfo | null) => void) | null = null;
  private clickCb: ((h: HoverInfo) => void) | null = null;
  private activeLevel: UnitLevel = "tract";
  basemapFailed = false;

  constructor(container: HTMLElement) {
    const noBasemap = new URLSearchParams(location.search).get("basemap") === "none";
    this.map = new maplibregl.Map({
      container,
      style: noBasemap ? BLANK_STYLE : BASEMAP,
      bounds: NYC_BOUNDS,
      fitBoundsOptions: { padding: { ...panelPadding(), top: 20, right: 20 } },
      maxBounds: [[-75.6, 39.7], [-72.3, 41.7]],
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    this.ready = new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.setup();
        resolve();
      };
      // If the free basemap is unreachable, fall back to a plain background (data still works).
      const fallback = setTimeout(() => {
        if (!this.map.isStyleLoaded()) {
          this.basemapFailed = true;
          this.map.setStyle(BLANK_STYLE);
          this.map.once("style.load", finish);
        }
      }, 8000);
      this.map.once("load", () => {
        clearTimeout(fallback);
        finish();
      });
      this.map.on("error", (e) => {
        console.error("map error:", e.error?.message ?? e);
        if (!done && !this.map.isStyleLoaded() && String(e.error?.message ?? "").includes("style")) {
          clearTimeout(fallback);
          this.basemapFailed = true;
          this.map.setStyle(BLANK_STYLE);
          this.map.once("style.load", finish);
        }
      });
    });
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  private setup() {
    const m = this.map;
    if (!new URLSearchParams(location.hash.slice(1)).get("a")) this.fitCity(false);
    const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol");
    this.beforeId = firstSymbol?.id;
    m.addImage("pat-hatch", pattern("hatch", "#adaca6"));
    m.addImage("pat-dots", pattern("dots", "rgba(255,255,255,0.95)"));
    m.addImage("pat-cross", pattern("cross", "#c9c8c2"));

    m.addSource("tracts", { type: "geojson", data: geoURL("tracts"), promoteId: "i" });
    m.addSource("ntas", { type: "geojson", data: geoURL("ntas"), promoteId: "i" });
    m.addSource("boroughs", { type: "geojson", data: geoURL("boroughs"), promoteId: "i" });
    m.addSource("enclaves", { type: "geojson", data: EMPTY_FC });
    m.addSource("clusters", { type: "geojson", data: EMPTY_FC });

    for (const lvl of ["tract", "nta"] as const) {
      const src = lvl === "tract" ? "tracts" : "ntas";
      this.add({ id: `${lvl}-fill`, type: "fill", source: src, paint: { "fill-color": "rgba(0,0,0,0)", "fill-opacity": 0.88 } });
      this.add({ id: `${lvl}-unavail`, type: "fill", source: src, filter: NONE, paint: { "fill-pattern": "pat-cross", "fill-opacity": 0.7 } });
      this.add({ id: `${lvl}-suppressed`, type: "fill", source: src, filter: NONE, paint: { "fill-pattern": "pat-hatch" } });
      this.add({ id: `${lvl}-caution`, type: "fill", source: src, filter: NONE, paint: { "fill-pattern": "pat-dots" } });
      this.add({
        id: `${lvl}-line`, type: "line", source: src,
        paint: { "line-color": "#ffffff", "line-width": lvl === "tract" ? ["interpolate", ["linear"], ["zoom"], 10, 0.1, 14, 0.8] : 0.8, "line-opacity": 0.8 },
      });
    }
    this.add({ id: "boro-line", type: "line", source: "boroughs", paint: { "line-color": "#6f6e69", "line-width": 1.2 } });
    this.add({ id: "enclave-fill", type: "fill", source: "enclaves", paint: { "fill-color": ENCLAVE_COLOR, "fill-opacity": 0.16 } });
    this.add({ id: "enclave-line", type: "line", source: "enclaves", paint: { "line-color": ENCLAVE_COLOR, "line-width": 2.2 } });
    this.add({ id: "cluster-line", type: "line", source: "clusters", paint: { "line-color": CLUSTER_COLOR, "line-width": 2, "line-dasharray": [2, 1] } });
    for (const lvl of ["tract", "nta"] as const) {
      this.add({
        id: `${lvl}-hover`, type: "line", source: lvl === "tract" ? "tracts" : "ntas", filter: NONE,
        paint: { "line-color": "#0b0b0b", "line-width": 2 },
      });
    }

    for (const lvl of ["tract", "nta"] as const) {
      m.on("mousemove", `${lvl}-fill`, (e) => {
        if (lvl !== this.activeLevel || !e.features?.length) return;
        const f = e.features[0];
        const idx = Number(f.properties?.i);
        m.setFilter(`${lvl}-hover`, ["==", ["get", "i"], idx]);
        m.getCanvas().style.cursor = "pointer";
        this.hoverCb?.({ level: lvl, index: idx, props: f.properties ?? {}, point: e.point });
      });
      m.on("mouseleave", `${lvl}-fill`, () => {
        m.setFilter(`${lvl}-hover`, NONE);
        m.getCanvas().style.cursor = "";
        this.hoverCb?.(null);
      });
      m.on("click", `${lvl}-fill`, (e) => {
        if (lvl !== this.activeLevel || !e.features?.length) return;
        const f = e.features[0];
        this.clickCb?.({ level: lvl, index: Number(f.properties?.i), props: f.properties ?? {}, point: e.point });
      });
    }
  }

  private add(layer: maplibregl.AddLayerObject) {
    this.map.addLayer(layer, this.beforeId);
  }

  onHover(cb: (h: HoverInfo | null) => void) {
    this.hoverCb = cb;
  }

  onClick(cb: (h: HoverInfo) => void) {
    this.clickCb = cb;
  }

  /** Paint the choropleth for one level; the other level is hidden. */
  setChoropleth(level: UnitLevel, colors: string[] | null, idx: { caution: number[]; suppressed: number[]; unavailable: number[] }) {
    const m = this.map;
    this.activeLevel = level;
    for (const lvl of ["tract", "nta"] as const) {
      const on = lvl === level && colors !== null;
      for (const suffix of ["fill", "unavail", "suppressed", "caution", "line", "hover"]) {
        m.setLayoutProperty(`${lvl}-${suffix}`, "visibility", on || (suffix === "fill" && lvl === level) ? "visible" : "none");
      }
    }
    if (!colors) {
      m.setPaintProperty(`${level}-fill`, "fill-color", "rgba(0,0,0,0)");
      return;
    }
    m.setPaintProperty(`${level}-fill`, "fill-color", ["to-color", ["at", ["get", "i"], ["literal", colors]]]);
    const inList = (l: number[]): FilterSpecification => (l.length ? ["in", ["get", "i"], ["literal", l]] : NONE);
    m.setFilter(`${level}-caution`, inList(idx.caution));
    m.setFilter(`${level}-suppressed`, inList(idx.suppressed));
    m.setFilter(`${level}-unavail`, inList(idx.unavailable));
  }

  setEnclaves(fc: GeoJSON.FeatureCollection | null, visible: boolean) {
    (this.map.getSource("enclaves") as GeoJSONSource).setData(fc ?? EMPTY_FC);
    for (const id of ["enclave-fill", "enclave-line"]) this.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }

  fitTo(bounds: [[number, number], [number, number]], pad = 40, animate = true) {
    const p = panelPadding();
    this.map.fitBounds(bounds, {
      padding: { top: pad, right: pad, left: p.left + pad, bottom: p.bottom + pad },
      maxZoom: 15,
      duration: animate ? 600 : 0,
    });
  }

  fitCity(animate = true) {
    this.fitTo(NYC_BOUNDS, 12, animate);
  }
}

export function bboxOf(geom: GeoJSON.Geometry): [[number, number], [number, number]] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  if ("coordinates" in geom) walk(geom.coordinates);
  return [[x0, y0], [x1, y1]];
}
