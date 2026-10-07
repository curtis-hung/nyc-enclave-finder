// Map legend: value bins plus visually distinct data states (§2.7) and overlay swatches.

import type { Scale } from "../scales";
import { ENCLAVE_COLOR, CLUSTER_COLOR, ZERO_COLOR } from "../scales";
import type { Metric } from "../types";

interface Props {
  metric: Metric;
  scale: Scale | null;
  shareOf: string;
  enclaves: boolean;
  clusters: boolean;
}

export function Legend({ metric, scale, shareOf, enclaves, clusters }: Props) {
  if (!scale) return null;
  const title =
    metric === "lq"
      ? "Location quotient — local share ÷ citywide share"
      : metric === "share"
        ? `Share of ${shareOf}`
        : "Estimated residents";
  return (
    <div class="legend" aria-label="Map legend">
      <div class="legend-title">{title}</div>
      <ul class="legend-bins">
        {scale.bins.map((b) => (
          <li key={b.label}>
            <span class="sw" style={{ background: b.color }} />
            {b.label}
            {metric === "lq" && b.hi === 1 && <span class="muted"> (not over-represented)</span>}
          </li>
        ))}
      </ul>
      <ul class="legend-states">
        <li><span class="sw sw-caution" /> Caution: noisy estimate</li>
        <li><span class="sw sw-suppressed" /> Suppressed: too uncertain to show</li>
        <li><span class="sw" style={{ background: ZERO_COLOR }} /> Zero estimated</li>
        <li><span class="sw sw-unavail" /> No data / no residents</li>
        {enclaves && <li><span class="sw sw-outline" style={{ borderColor: ENCLAVE_COLOR, background: `${ENCLAVE_COLOR}29` }} /> Residential enclave</li>}
        {clusters && <li><span class="sw sw-outline dashed" style={{ borderColor: CLUSTER_COLOR }} /> Restaurant cluster</li>}
      </ul>
    </div>
  );
}

/** Compact on-map legend for phones, where the panel is a bottom sheet (§9.8). */
export function MiniLegend({ metric, scale }: { metric: Metric; scale: Scale | null }) {
  if (!scale) return null;
  return (
    <div class="mini-legend" aria-hidden="true">
      <span class="mini-title">{metric === "lq" ? "LQ" : metric === "share" ? "Share" : "Residents"}</span>
      {scale.bins.map((b) => (
        <span key={b.label} class="mini-bin" title={b.label}>
          <span class="sw" style={{ background: b.color }} />
          {b.lo === null ? "" : b.lo}
        </span>
      ))}
      <span class="mini-bin"><span class="sw sw-suppressed" />n/a</span>
    </div>
  );
}
