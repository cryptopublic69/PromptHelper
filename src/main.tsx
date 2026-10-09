import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { isMacOS } from "./lib/platform";

document.documentElement.dataset.platform = isMacOS ? "macos" : "other";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
