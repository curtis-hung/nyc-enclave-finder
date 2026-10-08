// Area focus controls (§9.3): neighborhood, borough, radius pin with a 0.1-3 mi slider, and
// gazetteer presets (navigation only).

import type { GroupsFile, Meta, Place } from "../types";
import type { Area } from "../url";

interface Props {
  meta: Meta;
  groups: GroupsFile | null;
  places: Place[];
  area: Area | null;
  picking: boolean;
  onArea: (a: Area | null) => void;
  onPick: (on: boolean) => void;
  onPlace: (p: Place) => void;
}

export function FocusControls({ meta, groups, places, area, picking, onArea, onPick, onPlace }: Props) {
  const byBoro = meta.boroughs.map((b) => ({
    b,
    ntas: meta.ntas.filter((n) => n.boro === b.code).sort((x, y) => x.name.localeCompare(y.name)),
  }));
  const radius = area?.kind === "radius" ? area : null;
  const placeId = radius ? places.find((p) => Math.abs(p.lat - radius.lat) < 1e-4 && Math.abs(p.lon - radius.lon) < 1e-4)?.id ?? "" : "";

  return (
    <div class="ctl focus" role="group" aria-labelledby="focus-label">
      <span class="ctl-label" id="focus-label">Focus on an area</span>
      <div class="focus-row">
        <label class="sr-only" for="nta-select">Neighborhood</label>
        <select id="nta-select" value={area?.kind === "nta" ? area.id : ""}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            onArea(v ? { kind: "nta", id: v } : null);
          }}>
          <option value="">Neighborhood…</option>
          {byBoro.map(({ b, ntas }) => (
            <optgroup key={b.code} label={b.name}>
              {ntas.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
            </optgroup>
          ))}
        </select>
        {places.length > 0 && (
          <>
            <label class="sr-only" for="place-select">Places</label>
            <select id="place-select" value={placeId}
              onChange={(e) => {
                const p = places.find((x) => x.id === (e.target as HTMLSelectElement).value);
                if (p) onPlace(p);
              }}>
              <option value="">Places…</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.group && groups?.groups[p.group] ? ` — ${groups.groups[p.group].name}` : ""}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <div class="seg wrap" role="group" aria-label="Borough focus">
        {meta.boroughs.map((b) => (
          <button key={b.code} aria-pressed={area?.kind === "boro" && area.id === b.code} onClick={() => onArea({ kind: "boro", id: b.code })}>
            {b.name}
          </button>
        ))}
      </div>
      <div class="focus-row">
        <button class={`btn${picking ? " active" : ""}`} aria-pressed={picking} onClick={() => onPick(!picking)}>
          {picking ? "Click the map to drop the pin…" : radius ? "Move pin" : "Drop a radius pin"}
        </button>
        {area && <button class="link" onClick={() => onArea(null)}>Clear focus</button>}
      </div>
      {radius && (
        <div class="radius">
          <label for="radius-slider">Radius: <strong>{radius.mi.toFixed(2)} mi</strong></label>
          <input id="radius-slider" type="range" min="0.1" max="3" step="0.05" value={radius.mi}
            onInput={(e) => onArea({ ...radius, mi: +(e.target as HTMLInputElement).value })} />
        </div>
      )}
      <p class="muted small">Places are approximate navigation presets, not analytical boundaries. Choosing one also selects the group it is commonly associated with, so you can see how that group's residential pattern looks around it.</p>
    </div>
  );
}
