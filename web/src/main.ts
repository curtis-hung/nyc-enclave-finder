import { h, render } from "preact";
import "./style.css";
import { App } from "./ui/App";

render(h(App, {}), document.getElementById("app")!);

// Dev only: the MapLibre map is created once, imperatively, so hot-swapping components leaves it
// half-updated (stale layers, "Style is not done loading", buttons that stop responding). Reload
// the page on any script update instead; the view lives in the URL hash, so nothing is lost.
// Style-only updates still hot-swap.
if (import.meta.hot) {
  import.meta.hot.on("vite:beforeUpdate", (payload) => {
    if (payload.updates.some((u) => u.type === "js-update" && !u.path.endsWith(".css"))) location.reload();
  });
}
