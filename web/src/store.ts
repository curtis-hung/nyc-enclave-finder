// Minimal app store: the view state lives in the URL hash (§9.7); everything else derives from it.

import { useEffect, useState } from "preact/hooks";
import { DEFAULT_VIEW, parse, serialize, type ViewState } from "./url";

type Listener = (v: ViewState) => void;

class ViewStore {
  private state: ViewState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = typeof location !== "undefined" ? parse(location.hash) : DEFAULT_VIEW;
    if (typeof window !== "undefined") {
      window.addEventListener("hashchange", () => {
        const next = parse(location.hash);
        if (serialize(next) !== serialize(this.state)) {
          this.state = next;
          this.emit();
        }
      });
    }
  }

  get(): ViewState {
    return this.state;
  }

  set(patch: Partial<ViewState>): void {
    this.state = { ...this.state, ...patch };
    const hash = serialize(this.state);
    history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.state);
  }
}

export const view = new ViewStore();

export function useView(): ViewState {
  const [v, setV] = useState(view.get());
  useEffect(() => view.subscribe(setV), []);
  return v;
}
