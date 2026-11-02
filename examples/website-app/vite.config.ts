// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig, loadEnv } from "vite";

import { handleAgentTokenRequest } from "./server/agent-token.js";

// Only because the package lives in this repository: pointed at its source, so
// `bun run dev` needs no build first. Your own app installs it from npm.
const AGENTA_REACT_SRC = fileURLToPath(
    new URL("../../packages/react/src/index.ts", import.meta.url),
);

/**
 * The example's whole backend, mounted on the dev server so `bun run dev` is all
 * there is to run. Your own app already has somewhere for this to live.
 */
function agentTokenEndpoint(): Plugin {
    // There is no user database here, so every visitor is the same customer. A real
    // app returns its own id for the signed-in user, or null when there is none.
    const handle = handleAgentTokenRequest(async () => "demo-customer");

    return {
        name: "agent-token-endpoint",
        configureServer(server) {
            server.middlewares.use("/api/token", (request, response, next) => {
                if (request.method !== "POST") return next();

                void handle(new Request("http://localhost/api/token", { method: "POST" })).then(
                    async (minted) => {
                        response.statusCode = minted.status;
                        response.setHeader("Content-Type", "application/json");
                        response.end(await minted.text());
                    },
                    (error: unknown) => {
                        console.error("[agent-token]", error);
                        response.statusCode = 500;
                        response.end();
                    },
                );
            });
        },
    };
}

export default defineConfig(({ mode }) => {
    // Read in this process, by the middleware above. `loadEnv` rather than
    // `import.meta.env`, so the API key cannot reach the browser bundle.
    Object.assign(process.env, loadEnv(mode, process.cwd(), "AGENTA_"));

    return {
        plugins: [react(), agentTokenEndpoint()],
        resolve: { alias: { "@buildagenta/react": AGENTA_REACT_SRC } },
    };
});
