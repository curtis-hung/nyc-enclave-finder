import { h, render } from "preact";
import "./style.css";
import { App } from "./ui/App";

render(h(App, {}), document.getElementById("app")!);
