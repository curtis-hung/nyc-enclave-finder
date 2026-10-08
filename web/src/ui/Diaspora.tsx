// Diaspora strip (§4.6): birthplace and language at home within a group, reliable values only.
// Wording rule: "Born in the US", never "second generation".

import type { Measures } from "../diaspora";

const pct = (x: number) => (x < 0.1 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);
const moe = (se: number) => `± ${(se * 1.645 * 100).toFixed(1)} pts (90% MOE)`;

function heritageName(h: string[]): string {
  if (!h.length) return "the heritage language";
  if (h.length === 1) return h[0];
  return h.length <= 3 ? h.join(" / ") : `${h.slice(0, 3).join(" / ")}…`;
}

export function DiasporaStrip({ m, heritage, label, compact }: { m: Measures; heritage: string[]; label?: string; compact?: boolean }) {
  const has = (k: string) => k in m;
  const v = (k: string) => (
    <strong title={moe(m[k][1])}>{pct(m[k][0])}</strong>
  );
  const birth = ["born_us50", "born_pr", "born_abroad"].filter(has);
  const lang = ["heritage_lang", "english_only", "other_lang"].filter(has);
  if (!birth.length && !lang.length && !has("heritage_usborn") && !has("english_very_well") && !has("recent_arrival")) return null;
  const allBirth = birth.length === 3;
  const h = heritageName(heritage);
  return (
    <div class={`diaspora${compact ? " compact" : ""}`} role="group" aria-label="Diaspora detail">
      {label && <div class="dia-label">{label}</div>}
      {allBirth && (
        <div class="dia-bar" aria-hidden="true">
          <span class="seg us" style={{ width: `${m.born_us50[0] * 100}%` }} />
          <span class="seg pr" style={{ width: `${m.born_pr[0] * 100}%` }} />
          <span class="seg ab" style={{ width: `${m.born_abroad[0] * 100}%` }} />
        </div>
      )}
      {birth.length > 0 && (
        <div class="dia-line">
          {has("born_us50") && <span><i class="key us" />Born in the US {v("born_us50")}</span>}
          {has("born_pr") && <span><i class="key pr" />in PR / a territory {v("born_pr")}</span>}
          {has("born_abroad") && <span><i class="key ab" />abroad {v("born_abroad")}</span>}
          {has("recent_arrival") && <span>arrived &lt; 10 yrs ago {v("recent_arrival")} of those born abroad</span>}
        </div>
      )}
      {!birth.length && has("recent_arrival") && <div class="dia-line"><span>Arrived &lt; 10 yrs ago {v("recent_arrival")}</span></div>}
      {(lang.length > 0 || has("heritage_usborn")) && (
        <div class="dia-line">
          {has("heritage_lang") && <span>Speak {h} at home {v("heritage_lang")}</span>}
          {has("english_only") && <span>English only {v("english_only")}</span>}
          {has("other_lang") && <span>another language {v("other_lang")}</span>}
          {has("heritage_usborn") && <span>{h} among the US-born {v("heritage_usborn")}</span>}
        </div>
      )}
      {has("english_very_well") && !compact && (
        <div class="dia-line"><span>Speak English "very well" {v("english_very_well")} of those who speak another language at home</span></div>
      )}
    </div>
  );
}
