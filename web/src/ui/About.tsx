// About / methodology (SPEC §10): plain-language explanation of every principle, source and method.

import { useEffect, useRef } from "preact/hooks";
import type { Meta } from "../types";

const QUOTE = `"Lives here" means census-measured residence. "Eats here" means restaurant location. Neither proves cultural identity, causality or neighborhood ownership.`;

function fmtDate(s?: string) {
  return s ? s.slice(0, 10) : "—";
}

export function About({ meta, onClose }: { meta: Meta; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const src = meta.sources;
  const presets = meta.presets.presets;
  return (
    <div class="about-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="about" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header class="about-head">
          <h1 id="about-title">About NYC Enclave Finder</h1>
          <button ref={closeRef} class="close" aria-label="Close about" onClick={onClose}>×</button>
        </header>
        <blockquote class="quote">{QUOTE}</blockquote>
        <p>
          The map is half restaurant finder, half experiment. For any group it shows where the group <em>lives</em> (Census residence),
          where its restaurants <em>cluster</em> (restaurant locations) and continuous measures of how the two relate. It measures; you draw the conclusions.
        </p>

        <h2>Principles</h2>
        <ul>
          <li><strong>Over-representation, not dominance.</strong> The main measure is the location quotient: LQ = the group's share here ÷ its share citywide. A group that is 8% of a tract but 1% of the city (LQ 8) stands out more than one that is 40% here and 35% citywide (LQ 1.1). The biggest group is not the most distinctive one.</li>
          <li><strong>Never one winner.</strong> Every over-represented group is listed; rankings are for display only.</li>
          <li><strong>Residence and restaurants are separate lenses.</strong> Census data describe where people live; restaurant data describe where a cuisine is sold. Each is analysed on its own and only then compared. Restaurant labels come only from restaurant data — residential data never label, tag or cluster restaurants, and restaurants never define enclaves. Residential context shown beside restaurants is labelled as context, not evidence.</li>
          <li><strong>Exploratory.</strong> No area is given a category (no "co-located", "detached" or "legacy" labels), and thresholds were set once for the whole city, not tuned so that known neighbourhoods tell a story. Connector lines and proximity show distance only — never a causal or cultural relationship.</li>
          <li><strong>Honest dimensions.</strong> Race/Hispanic origin, detailed Asian groups, ancestry, country of birth and home language measure different things over different populations: the Asian table counts people who reported only Asian race; country of birth counts immigrants only; language counts people aged 5+; one person can report two ancestries. Every share is labelled with what it is a share of, and LQs only compare like with like (same table, same denominator).</li>
          <li><strong>No adding across dimensions.</strong> Broad groups add up categories within one table only (never ancestry, where people can be counted twice).</li>
          <li><strong>Honest uncertainty.</strong> Every value has a state from its margin of error: <em>reliable</em> (CV ≤ 0.30), <em>caution</em> (dotted; CV ≤ 0.60, or ≤ 0.80 on tract maps), <em>suppressed</em> (hatched; too uncertain to show), <em>no data</em> (cross-hatched) and <em>zero</em> (a real zero estimate). Missing or suppressed values never look like zero. Tiny populations cannot produce extreme LQs (minimum 50 residents in an area, 200 citywide). Groups too sparse at tract level are shown by neighbourhood.</li>
          <li><strong>No centroid trap.</strong> Distances are measured to the group's actual enclaves, never to a single citywide average point, which can land somewhere meaningless (even in the water) for groups with several concentrations.</li>
        </ul>

        <h2>Sources and snapshot dates</h2>
        <p>All data are downloaded once at build time; the site makes no live API calls.</p>
        <table class="tbl about-tbl">
          <thead><tr><th>Source</th><th>Vintage / snapshot</th><th>Fetched</th></tr></thead>
          <tbody>
            {Object.entries(src).map(([id, s]) => (
              <tr key={id}><td>{s.name ?? id}{s.publisher ? <span class="muted"> — {s.publisher}</span> : null}</td><td>{s.vintage}</td><td>{fmtDate(s.fetched_at)}</td></tr>
            ))}
          </tbody>
        </table>
        <p class="small">
          Licenses and credits: Census data are U.S. government works (public domain). NYC geography and DOHMH inspections come from NYC Open Data under its terms of use.
          Map-derived cuisine tags and places of worship contain information from OpenStreetMap, © OpenStreetMap contributors, available under the Open Database License (ODbL);
          Overture Maps Places data are under CDLA-Permissive-2.0. The basemap is © OpenFreeMap, OpenMapTiles and OpenStreetMap contributors.
          The code is MIT-licensed; see <code>LICENSE</code> and <code>DATA_LICENSE.md</code> in the repository.
        </p>

        <h2>Restaurants and cuisine labels</h2>
        <p>
          The backbone is NYC Health Department inspection data: one record per establishment, kept if it was inspected in the last three years (new permits without an inspection are shown but not analysed).
          Each restaurant has one <strong>primary label</strong> — the Department's cuisine category, always shown — and zero or more <strong>inferred tags</strong> (marked ≈) that add detail below it in a cuisine hierarchy
          (e.g. a "Latin American" place tagged Ecuadorian). Tags come from OpenStreetMap, Overture Maps and a small name-keyword list, matched to restaurants by name within 75 m.
          A tag's confidence is derived, never set by hand: <em>high</em> when two independent sources agree, <em>medium</em> for one map source, <em>low</em> for a name keyword alone.
          Labels that do not fit under the primary are kept apart under "Other sources say…" and never used. Map coverage is uneven, so tag-based clusters report their <em>tag coverage</em>.
        </p>
        <p>
          <strong>Multi-location businesses</strong> (the same normalized name at 7 or more locations) are hidden by default and left out of the analysis. This is a name heuristic, not proof of a corporate chain:
          independently owned franchises and regional businesses can be flagged, and differently named branches of one company are not.
        </p>

        <h2>Residential enclaves</h2>
        <p>
          A tract (or neighbourhood, for sparse groups) qualifies when the group's LQ, count and data quality all pass the preset's thresholds; touching qualifying units join into one enclave, which must hold
          a minimum number of the group's residents. Neighbours are decided on unclipped census geometry so shoreline clipping never changes them.
        </p>

        <h2>Restaurant clusters</h2>
        <p>
          Each cuisine is clustered on its own (DBSCAN on projected coordinates). A restaurant can only seed a cluster where its cuisine is over-represented nearby, which stops clusters from chaining
          across dense, ordinary-mix areas. A cluster then qualifies on its <strong>cuisine LQ</strong>: the cuisine's share of <em>all</em> restaurants in the cluster's catchment (its footprint plus a buffer) ÷ its
          share citywide. This is not circular — the share is measured over every restaurant in the catchment, not just the cuisine's own points, and each restaurant counts once however many tags it has.
          Restaurant density alone never qualifies a cluster. Very common cuisines have a low LQ ceiling (Asian restaurants are about a quarter of all restaurants, so their LQ can never exceed about 4), so a cluster
          also qualifies when the cuisine closes a set fraction of the gap between its citywide share and 100% of the catchment — whichever test is easier; such clusters are marked "share gap".
        </p>
        <p>
          Some clusters carry a colloquial name (Koreatown, Curry Hill, Manhattan Chinatown…). The name is attached afterwards, for orientation only: a cluster takes the name of a
          hand-listed place when the place's approximate circle reaches the cluster and the group the place is commonly associated with pairs with the cuisine. Names never
          define, find or qualify clusters, and an unnamed cluster is no less of a cluster.
        </p>

        <h2>Gap measures</h2>
        <p>
          For every cluster and every declared group pairing: distance to the 1st, 2nd and 3rd nearest enclave (polygon to polygon; 0 when they touch), a signed <em>edge distance</em> from the cluster's
          centre to the nearest enclave edge (negative = inside), the overlap with enclaves, the group's residential LQ inside the cluster's catchment, and the share of the group's citywide residents within
          0.5, 1, 2 and 5 miles. A group with no enclave gets no distance (blank), never a made-up large one. "Bucket" cuisines (Latin American, Caribbean…) are measured against the broad group they cover,
          and their panels show which smaller groups live nearby — as context, not evidence of what the restaurants serve.
        </p>

        <h2>Presets</h2>
        <p>Three precomputed definitions let you see how much the picture depends on thresholds (Advanced → Analytical preset).</p>
        <table class="tbl about-tbl">
          <thead><tr><th></th>{Object.values(presets).map((p) => <th key={p.label}>{p.label}</th>)}</tr></thead>
          <tbody>
            <tr><td>Enclave LQ ≥</td>{Object.values(presets).map((p) => <td key={p.label}>{p.enclave.lq_min}</td>)}</tr>
            <tr><td>Residents per unit ≥</td>{Object.values(presets).map((p) => <td key={p.label}>{p.enclave.count_min}</td>)}</tr>
            <tr><td>Data states allowed</td>{Object.values(presets).map((p) => <td key={p.label}>{p.enclave.states.join(", ")}</td>)}</tr>
            <tr><td>Enclave residents ≥</td>{Object.values(presets).map((p) => <td key={p.label}>{p.enclave.min_enclave_pop}</td>)}</tr>
            <tr><td>Cluster radius (ft)</td>{Object.values(presets).map((p) => <td key={p.label}>{p.cluster.eps_ft}</td>)}</tr>
            <tr><td>Min. restaurants</td>{Object.values(presets).map((p) => <td key={p.label}>{p.cluster.min_cluster_size}</td>)}</tr>
            <tr><td>Catchment buffer (ft)</td>{Object.values(presets).map((p) => <td key={p.label}>{p.cluster.catchment_ft}</td>)}</tr>
            <tr><td>Cuisine LQ ≥ / share gap ≥</td>{Object.values(presets).map((p) => <td key={p.label}>{p.cluster.lq_min} / {p.cluster.gap_min}</td>)}</tr>
          </tbody>
        </table>

        <h2>Areas</h2>
        <p>
          Neighbourhood and borough figures are exact sums of census tracts. <strong>Radius figures are approximate</strong>: a circle cuts through tracts, so each tract counts in proportion to the share of its land
          inside the circle, which assumes residents are spread evenly across the tract. Their margins of error are approximate too. Comparing with the borough instead of the city asks a different question:
          being common borough-wide raises the bar.
        </p>

        <h2>Diaspora detail</h2>
        <p>
          Where the data are strong enough, groups show who was born in the US, in Puerto Rico or a US territory, or abroad (and how recently they arrived), and who speaks the heritage language, only English
          or another language at home. These come from Census microdata (PUMS), which only exist for ~55 large districts, so a strip describes the <em>surrounding district</em> (named in the label), not your
          exact area. "Born in the US" includes second, third and later generations — the data cannot tell them apart. Puerto Rico is separate because island-born people count as US-born in Census data.
          A number appears only with at least 30 sampled people and a coefficient of variation of 0.30 or less; anything thinner is simply not shown, which is why some groups or areas have no strip at all.
          Detailed languages (e.g. Bengali within "Other Indo-European") fill in under the broad tract-level categories the same way.
        </p>

        <h2>Find food</h2>
        <p>
          Find food lists candidate restaurants for the selected cuisine: nearby a starting point (your location, a ZIP code or a point you click on the map), in a neighborhood or borough,
          in the cuisine's restaurant clusters, near where the paired community lives, or off the beaten path (outside every cluster). Sharing your location is optional:
          the browser asks only if you press "Use my location", and the location stays on your device and is never put in the URL. ZIP codes are placed at the middle of their restaurants.
          You choose the order: closest, surest cuisine match (DOHMH category first, then inferred tags by confidence) or shuffled. Nothing is ranked by quality, because the data has no ratings.
          "Near where the community lives" uses census residence only to decide where to look; a restaurant's cuisine always comes from restaurant data.
        </p>

        <h2>Other notes</h2>
        <ul>
          <li><strong>Jewish (Yiddish-language proxy).</strong> The Census does not measure religion. This group is approximated by people who speak Yiddish at home (at tract level, the "German or other West Germanic" language category). It misses most Jewish New Yorkers.</li>
          <li><strong>Diversity index</strong> = how evenly residents spread across the eight race/Hispanic-origin categories (normalized Shannon entropy, 0 to 1). It describes mix only; it is not a score.</li>
          <li><strong>Places of worship</strong> come from OpenStreetMap and have incomplete, uneven coverage. Religion is shown only as tagged; it is never inferred from ethnicity.</li>
          <li>Code, data snapshots and decisions are documented in the repository (README, DECISIONS.md).</li>
        </ul>
      </div>
    </div>
  );
}
