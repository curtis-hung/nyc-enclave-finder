// Group focus controls and summary (§9.1): dimension switcher, metric, units, enclave table.

import { fmtCount, fmtLQ, fmtShare } from "../scales";
import { view } from "../store";
import type { EnclaveBundle, EnclaveItem, Group, GroupsFile, Meta, Metric } from "../types";
import type { ViewState } from "../url";

const METRICS: { id: Metric; label: string }[] = [
  { id: "lq", label: "LQ" },
  { id: "share", label: "% share" },
  { id: "count", label: "Count" },
];

interface Props {
  meta: Meta;
  groups: GroupsFile;
  group: Group;
  dim: string;
  level: "tract" | "nta";
  preset: string;
  v: ViewState;
  enc: EnclaveBundle | null;
  onEnclave: (item: EnclaveItem) => void;
}

export function GroupSection({ meta, groups, group, dim, level, preset, v, enc, onEnclave }: Props) {
  const dimMeta = group.dims[dim];
  const dimDef = meta.dimensions[dim];
  const enclaveSet = enc?.stats[dim]?.[preset] ?? null;
  const presetLabel = meta.presets.presets[preset].label.toLowerCase();
  return (
    <>
      {group.proxy && <p class="notice proxy" role="note"><strong>Proxy measure.</strong> {group.rationale}</p>}
      <div class="ctl">
        <span class="ctl-label" id="dim-label">Dimension</span>
        <div class="seg wrap" role="group" aria-labelledby="dim-label">
          {Object.entries(meta.dimensions).map(([id, d]) => {
            const has = !!group.dims[id];
            return (
              <button key={id} aria-pressed={id === dim} disabled={!has} title={has ? d.name : `No data: ${group.name} is not a category in ${d.name}`}
                onClick={() => view.set({ dim: id, level: null })}>
                {d.short}{!has && <span class="nodata"> · no data</span>}
                {has && group.dims[id].bucket && <span class="badge">bucket</span>}
                {id === group.default_dimension && <span class="dot" title="Default dimension">•</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div class="ctl-row">
        <div class="ctl">
          <span class="ctl-label" id="metric-label">Show</span>
          <div class="seg" role="group" aria-labelledby="metric-label">
            {METRICS.map((m) => <button key={m.id} aria-pressed={v.metric === m.id} onClick={() => view.set({ metric: m.id })}>{m.label}</button>)}
          </div>
        </div>
        <div class="ctl">
          <span class="ctl-label" id="level-label">Units</span>
          <div class="seg" role="group" aria-labelledby="level-label">
            <button aria-pressed={level === "tract"} onClick={() => view.set({ level: "tract" })}>Tracts</button>
            <button aria-pressed={level === "nta"} onClick={() => view.set({ level: "nta" })}>Neighborhoods</button>
          </div>
        </div>
      </div>
      {dimMeta.level === "nta" && (
        <p class="notice" role="note">
          Too sparse at tract level: only {Math.round(dimMeta.usable_share_tract * 100)}% of {group.name} residents in this dimension live in tracts with a usable estimate, so the map defaults to neighborhoods (NTAs).
        </p>
      )}
      <section class="summary" aria-label="Group summary" role="region">
        <h2>{group.name} <span class="muted">· {dimDef.name}</span></h2>
        <p class="def">
          Shares are of <strong>{dimDef.share_of}</strong>. Counted: {dimDef.numerator_universe}.
          {dimMeta.bucket && <> <span class="badge">bucket</span> Source category: {dimMeta.bucket}.</>}
          {dimMeta.derived && <> Summed from {dimMeta.labels.length} categories{dimMeta.missing_from_sum.length ? ` (not included: ${dimMeta.missing_from_sum.map((c) => groups.groups[c]?.name ?? c).join(", ")})` : ""}.</>}
        </p>
        <dl class="kv">
          <dt>Citywide</dt>
          <dd>{fmtCount(dimMeta.city.e)}{dimMeta.city.m ? ` ± ${fmtCount(dimMeta.city.m)}` : ""} ({fmtShare(dimMeta.city.share)})</dd>
          <dt>Default dimension</dt>
          <dd>{meta.dimensions[group.default_dimension].name}. {group.rationale}</dd>
        </dl>
      </section>
      <section class="enclaves" aria-label="Residential enclaves" role="region">
        <div class="sec-head">
          <h3>Residential enclaves</h3>
          <label class="check"><input type="checkbox" checked={v.enclaves} onChange={(e) => view.set({ enclaves: (e.target as HTMLInputElement).checked })} /> Show</label>
        </div>
        {enclaveSet ? (
          enclaveSet.items.length ? (
            <>
              <p class="muted small">{enclaveSet.items.length} enclave{enclaveSet.items.length > 1 ? "s" : ""} under the {presetLabel} preset ({enclaveSet.level === "nta" ? "neighborhood" : "tract"} level). Click to zoom.</p>
              <table class="tbl">
                <thead><tr><th>#</th><th>Residents</th><th>Of citywide</th><th>Peak LQ</th><th>{enclaveSet.level === "nta" ? "NTAs" : "Tracts"}</th></tr></thead>
                <tbody>
                  {enclaveSet.items.slice(0, 12).map((it, k) => (
                    <tr key={it.id} tabIndex={0} class="clickable" onClick={() => onEnclave(it)} onKeyDown={(e) => e.key === "Enter" && onEnclave(it)}>
                      <td>{k + 1}</td><td>{fmtCount(it.pop)}</td><td>{fmtShare(it.share)}</td><td>{fmtLQ(it.peak_lq)}</td><td>{it.n_units}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {enclaveSet.items.length > 12 && <p class="muted small">+ {enclaveSet.items.length - 12} smaller enclaves on the map.</p>}
            </>
          ) : (
            <p class="muted small">No area meets the {presetLabel} enclave thresholds for this dimension.</p>
          )
        ) : (
          enc && <p class="muted small">Enclaves for non-default dimensions are computed under the default preset only.</p>
        )}
      </section>
    </>
  );
}
