// Searchable, hierarchical group picker (§9.1).

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Group, GroupsFile } from "../types";

interface Props {
  groups: GroupsFile;
  selected: string | null;
  onSelect: (id: string) => void;
}

function pathOf(groups: GroupsFile, id: string): string[] {
  const out: string[] = [];
  let g: Group | undefined = groups.groups[id];
  while (g && g.parent) {
    g = groups.groups[g.parent];
    if (g) out.unshift(g.name);
  }
  return out;
}

function norm(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function GroupPicker({ groups, selected, onSelect }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(!selected);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (selected) setOpen(false); }, [selected]);

  const matches = useMemo(() => {
    const nq = norm(q.trim());
    if (!nq) return null;
    return Object.values(groups.groups)
      .filter((g) => norm(g.name).includes(nq) || norm(g.id).includes(nq))
      .sort((a, b) => {
        const as = norm(a.name).startsWith(nq) ? 0 : 1;
        const bs = norm(b.name).startsWith(nq) ? 0 : 1;
        return as - bs || a.name.localeCompare(b.name);
      })
      .slice(0, 40);
  }, [q, groups]);

  const choose = (id: string) => {
    onSelect(id);
    setQ("");
    setOpen(false);
  };

  const toggle = (id: string) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  const renderNode = (id: string, depth: number) => {
    const g = groups.groups[id];
    const isOpen = expanded.has(id);
    return (
      <li key={id} role="none">
        <div class="tree-row" style={{ paddingLeft: `${depth * 14}px` }}>
          {g.children.length > 0 ? (
            <button class="tree-toggle" aria-label={`${isOpen ? "Collapse" : "Expand"} ${g.name}`} aria-expanded={isOpen} onClick={() => toggle(id)}>
              {isOpen ? "▾" : "▸"}
            </button>
          ) : (
            <span class="tree-spacer" />
          )}
          <button role="option" aria-selected={id === selected} class={`tree-item${id === selected ? " sel" : ""}`} onClick={() => choose(id)}>
            {g.name}
            {g.proxy && <span class="badge" title="Measured through a proxy category">proxy</span>}
          </button>
        </div>
        {isOpen && g.children.length > 0 && <ul role="group">{g.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  const sel = selected ? groups.groups[selected] : null;

  return (
    <div class="picker">
      <label class="ctl-label" for="group-search">Group</label>
      {sel && !open ? (
        <button class="picker-current" onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }} aria-label={`Change group (current: ${sel.name})`}>
          <span class="picker-path">{pathOf(groups, sel.id).join(" › ")}</span>
          <span class="picker-name">{sel.name}</span>
          <span class="picker-change">Change</span>
        </button>
      ) : (
        <>
          <input
            id="group-search"
            ref={inputRef}
            type="search"
            aria-expanded="true"
            aria-controls="group-list"
            placeholder="Search groups — e.g. Thai, Ecuadorian, Haitian"
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches && matches.length) choose(matches[0].id);
              if (e.key === "Escape" && sel) setOpen(false);
            }}
          />
          <ul id="group-list" class="tree" role="listbox" aria-label="Groups">
            {matches
              ? matches.length
                ? matches.map((g) => (
                    <li key={g.id} role="none">
                      <button role="option" aria-selected={g.id === selected} class="tree-item flat" onClick={() => choose(g.id)}>
                        {g.name}
                        <span class="crumb">{pathOf(groups, g.id).join(" › ")}</span>
                      </button>
                    </li>
                  ))
                : <li class="muted">No group matches “{q}”.</li>
              : groups.roots.map((r) => renderNode(r, 0))}
          </ul>
          {sel && <button class="link" onClick={() => setOpen(false)}>Cancel</button>}
        </>
      )}
    </div>
  );
}
