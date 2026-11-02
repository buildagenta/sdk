// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import "@copilotkit/react-ui/v2/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
