import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";

import App from "./App";

const node = document.getElementById("root");
if (!node) throw new Error("缺少 #root 挂载点");

createRoot(node).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
