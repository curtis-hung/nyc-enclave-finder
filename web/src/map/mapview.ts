// Imperative MapLibre wrapper: basemap, choropleth with data-state textures, enclaves.

import * as maplibregl from "maplibre-gl";
import { type FilterSpecification, type GeoJSONSource, type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

maplibregl.setWorkerUrl(workerUrl);
import { CLUSTER_COLOR, ENCLAVE_COLOR, RESTAURANT_COLOR } from "../scales";
import { geoURL } from "../data";
import { inverseMask } from "../geo";

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
export function panelPadding(): { left: number; right: number; bottom: number } {
  const panel = document.querySelector(".panel:not(.panel-right)") as HTMLElement | null;
  const right = document.querySelector(".panel-right") as HTMLElement | null;
  const drawer = document.querySelector(".gaps-drawer") as HTMLElement | null;
  if (window.innerWidth >= 768) {
    return { left: (panel?.offsetWidth ?? 380) + 24, right: right ? right.offsetWidth + 24 : 0, bottom: drawer ? drawer.offsetHeight + 24 : 20 };
  }
  if (drawer) return { left: 10, right: 0, bottom: drawer.offsetHeight + 10 };
  const sheet = right ?? panel;
  return { left: 10, right: 0, bottom: Math.min((sheet?.offsetHeight ?? 0) + 10, window.innerHeight * 0.6) };
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const NONE: FilterSpecification = ["==", ["get", "i"], -1];
const NONE_ID: FilterSpecification = ["==", ["get", "id"], "__none__"];

export class MapView {
  readonly map: MLMap;
  private ready: Promise<void>;
  private beforeId: string | undefined;
  private hoverCb: ((h: HoverInfo | null) => void) | null = null;
  private clickCb: ((at: { lon: number; lat: number }, unit: HoverInfo | null) => void) | null = null;
  private pin: maplibregl.Marker | null = null;
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
    this.add({ id: "cluster-fill", type: "fill", source: "clusters", filter: ["==", ["get", "part"], "footprint"], paint: { "fill-color": CLUSTER_COLOR, "fill-opacity": 0.08 } });
    this.add({ id: "cluster-line", type: "line", source: "clusters", filter: ["==", ["get", "part"], "footprint"], paint: { "line-color": CLUSTER_COLOR, "line-width": 2, "line-dasharray": [2, 1] } });
    this.add({ id: "cluster-catch", type: "line", source: "clusters", filter: NONE_ID, paint: { "line-color": CLUSTER_COLOR, "line-width": 1.2, "line-dasharray": [1, 2], "line-opacity": 0.8 } });
    this.add({ id: "cluster-sel", type: "line", source: "clusters", filter: NONE_ID, paint: { "line-color": CLUSTER_COLOR, "line-width": 3.5 } });
    m.addSource("mask", { type: "geojson", data: EMPTY_FC });
    m.addSource("focus", { type: "geojson", data: EMPTY_FC });
    this.add({ id: "mask-fill", type: "fill", source: "mask", paint: { "fill-color": "#e9e8e3", "fill-opacity": 0.82 } });
    this.add({ id: "focus-line", type: "line", source: "focus", paint: { "line-color": "#0b0b0b", "line-width": 2.2 } });
    m.addSource("gapfocus", { type: "geojson", data: EMPTY_FC });
    this.add({ id: "gap-enclave-fill", type: "fill", source: "gapfocus", filter: ["==", ["get", "part"], "enclave"], paint: { "fill-color": ENCLAVE_COLOR, "fill-opacity": 0.28 } });
    this.add({ id: "gap-enclave-line", type: "line", source: "gapfocus", filter: ["==", ["get", "part"], "enclave"], paint: { "line-color": ENCLAVE_COLOR, "line-width": 3.5 } });
    this.add({ id: "gap-catch", type: "line", source: "gapfocus", filter: ["==", ["get", "part"], "catchment"], paint: { "line-color": CLUSTER_COLOR, "line-width": 1.4, "line-dasharray": [1, 2] } });
    this.add({ id: "gap-cluster", type: "line", source: "gapfocus", filter: ["==", ["get", "part"], "footprint"], paint: { "line-color": CLUSTER_COLOR, "line-width": 3.5 } });
    this.add({ id: "gap-hover", type: "line", source: "gapfocus", filter: ["==", ["get", "part"], "hover"], paint: { "line-color": "#0b0b0b", "line-width": 2.5 } });
    m.addSource("restaurants", { type: "geojson", data: EMPTY_FC });
    this.add({
      id: "rest-heat", type: "heatmap", source: "restaurants", maxzoom: 14,
      paint: {
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 6, 13, 18],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 13, 1.2],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, 0.75, 14, 0],
        "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(200,16,46,0)", 0.2, "rgba(200,16,46,0.25)", 0.5, "rgba(200,16,46,0.55)", 1, "rgba(140,8,30,0.9)"],
      },
    });
    this.add({
      id: "rest-pt", type: "circle", source: "restaurants", minzoom: 12.5,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.5, 2.5, 16, 6],
        "circle-color": ["case", ["==", ["get", "k"], 2], "#ffffff", ["==", ["get", "m"], 1], "#e8909e", RESTAURANT_COLOR],
        "circle-stroke-color": ["case", ["==", ["get", "k"], 2], RESTAURANT_COLOR, "#ffffff"],
        "circle-stroke-width": ["case", ["==", ["get", "k"], 2], 2, 1],
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, 0, 13.2, 1],
        "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, 0, 13.2, 1],
      },
    });
    this.add({ id: "rest-sel", type: "circle", source: "restaurants", filter: NONE, paint: { "circle-radius": 9, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#0b0b0b", "circle-stroke-width": 2.5 } });
    for (const [lvl, src] of [["tract", "tracts"], ["nta", "ntas"], ["boro", "boroughs"]] as const) {
      this.add({ id: `${lvl}-sel`, type: "line", source: src, filter: NONE, paint: { "line-color": "#0b0b0b", "line-width": 3 } });
    }
    for (const lvl of ["tract", "nta"] as const) {
      this.add({
        id: `${lvl}-hover`, type: "line", source: lvl === "tract" ? "tracts" : "ntas", filter: NONE,
        paint: { "line-color": "#0b0b0b", "line-width": 2 },
      });
    }

    m.on("mousemove", "rest-pt", (e) => {
      if (m.getZoom() < 13 || !e.features?.length) return;
      m.getCanvas().style.cursor = "pointer";
      this.restHoverCb?.({ index: Number(e.features[0].properties?.i), point: e.point });
    });
    m.on("mouseleave", "rest-pt", () => {
      m.getCanvas().style.cursor = "";
      this.restHoverCb?.(null);
    });
    m.on("click", (e) => {
      const r = m.getLayer("rest-pt") && m.getZoom() >= 13 ? m.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: ["rest-pt"] })[0] : null;
      if (r && this.restaurantCb && !this.pickingOn) {
        this.restaurantCb(Number(r.properties?.i));
        return;
      }
      const lvl = this.activeLevel;
      const f = m.queryRenderedFeatures(e.point, { layers: [`${lvl}-fill`] })[0];
      const unit = f ? { level: lvl, index: Number(f.properties?.i), props: f.properties ?? {}, point: e.point } : null;
      this.clickCb?.({ lon: e.lngLat.lng, lat: e.lngLat.lat }, unit);
    });

    for (const lvl of ["tract", "nta"] as const) {
      m.on("mousemove", `${lvl}-fill`, (e) => {
        if (lvl !== this.activeLevel || !e.features?.length) return;
        const f = e.features[0];
        const idx = Number(f.properties?.i);
        m.setFilter(`${lvl}-hover`, ["==", ["get", "i"], idx]);
        if (m.getCanvas().style.cursor !== "crosshair") m.getCanvas().style.cursor = "pointer";
        this.hoverCb?.({ level: lvl, index: idx, props: f.properties ?? {}, point: e.point });
      });
      m.on("mouseleave", `${lvl}-fill`, () => {
        m.setFilter(`${lvl}-hover`, NONE);
        if (m.getCanvas().style.cursor !== "crosshair") m.getCanvas().style.cursor = "";
        this.hoverCb?.(null);
      });
    }
  }

  private add(layer: maplibregl.AddLayerObject) {
    this.map.addLayer(layer, this.beforeId);
  }

  onHover(cb: (h: HoverInfo | null) => void) {
    this.hoverCb = cb;
  }

  onClick(cb: (at: { lon: number; lat: number }, unit: HoverInfo | null) => void) {
    this.clickCb = cb;
  }

  /** Whether an inverse mask is shown (for tests and debugging). */
  focusState(): { masked: boolean } {
    return { masked: this.masked };
  }
  private masked = false;

  private restaurantCb: ((i: number) => void) | null = null;
  private pickingOn = false;

  onRestaurant(cb: (i: number) => void) {
    this.restaurantCb = cb;
  }

  private restHoverCb: ((h: { index: number; point: { x: number; y: number } } | null) => void) | null = null;
  onRestaurantHover(cb: (h: { index: number; point: { x: number; y: number } } | null) => void) {
    this.restHoverCb = cb;
  }

  setRestaurants(fc: GeoJSON.FeatureCollection | null, selected: number | null) {
    (this.map.getSource("restaurants") as GeoJSONSource).setData(fc ?? EMPTY_FC);
    this.shown.restaurants = fc?.features.length ?? 0;
    this.map.setFilter("rest-sel", selected === null ? NONE : ["==", ["get", "i"], selected]);
  }

  setClusters(fc: GeoJSON.FeatureCollection | null, selected: string | null) {
    this.shown.clusters = [...new Set((fc?.features ?? []).map((f) => String(f.properties?.id)))];
    (this.map.getSource("clusters") as GeoJSONSource).setData(fc ?? EMPTY_FC);
    const part = (p: string): FilterSpecification =>
      selected ? ["all", ["==", ["get", "id"], selected], ["==", ["get", "part"], p]] : NONE_ID;
    this.map.setFilter("cluster-catch", part("catchment"));
    this.map.setFilter("cluster-sel", part("footprint"));
  }

  /** Experiment view: highlight a cluster (footprint + catchment) and its nearest enclave. */
  setGapFocus(features: GeoJSON.Feature[]) {
    this.shown.gap = features.map((f) => String(f.properties?.part));
    (this.map.getSource("gapfocus") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }

  setPicking(on: boolean) {
    this.pickingOn = on;
    this.map.getCanvas().style.cursor = on ? "crosshair" : "";
  }

  /** Grey out everything outside the focused area and outline it (§9.3). */
  setFocus(area: GeoJSON.Polygon | GeoJSON.MultiPolygon | null) {
    (this.map.getSource("mask") as GeoJSONSource).setData(area ? inverseMask(area) : EMPTY_FC);
    this.masked = !!area;
    (this.map.getSource("focus") as GeoJSONSource).setData(area ? { type: "Feature", properties: {}, geometry: area } : EMPTY_FC);
  }

  /** Draggable radius pin. */
  setPin(at: { lon: number; lat: number } | null, onMove?: (at: { lon: number; lat: number }) => void) {
    if (!at) {
      this.pin?.remove();
      this.pin = null;
      return;
    }
    if (!this.pin) {
      this.pin = new maplibregl.Marker({ draggable: true, color: "#0b0b0b" }).setLngLat([at.lon, at.lat]).addTo(this.map);
      this.pin.getElement().setAttribute("aria-label", "Radius center (drag to move)");
    } else {
      this.pin.setLngLat([at.lon, at.lat]);
    }
    this.pin.off("dragend", this.onPinDrag);
    this.pinMove = onMove ?? null;
    this.pin.on("dragend", this.onPinDrag);
  }

  private pinMove: ((at: { lon: number; lat: number }) => void) | null = null;
  private onPinDrag = () => {
    const ll = this.pin!.getLngLat();
    this.pinMove?.({ lon: ll.lng, lat: ll.lat });
  };

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

  /** Outline the selected unit (or clear the selection). */
  setSelection(sel: { level: "tract" | "nta" | "boro"; index: number } | null) {
    for (const lvl of ["tract", "nta", "boro"] as const) {
      this.map.setFilter(`${lvl}-sel`, sel && sel.level === lvl ? ["==", ["get", "i"], sel.index] : NONE);
    }
  }

  /** What the map currently shows, for tests and debugging (behaviour, not pixels). */
  readonly shown = { enclaves: [] as string[], clusters: [] as string[], gap: [] as string[], restaurants: 0 };

  setEnclaves(fc: GeoJSON.FeatureCollection | null, visible: boolean) {
    this.shown.enclaves = visible ? (fc?.features ?? []).map((f) => String(f.properties?.id)) : [];
    (this.map.getSource("enclaves") as GeoJSONSource).setData(fc ?? EMPTY_FC);
    for (const id of ["enclave-fill", "enclave-line"]) this.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }

  fitTo(bounds: [[number, number], [number, number]], pad = 40, animate = true) {
    const p = panelPadding();
    this.map.fitBounds(bounds, {
      padding: { top: pad + (window.innerWidth < 768 ? 34 : 0), right: p.right + pad, left: p.left + pad, bottom: p.bottom + pad },
      maxZoom: 14,
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
