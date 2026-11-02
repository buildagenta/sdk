// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "bun:test";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { AgentaProvider, AgentaStatus, useAgenta, useAgentaThreads } from "../src/index.js";

const originalFetch = globalThis.fetch;

function Threads(): ReactNode {
    const { threads } = useAgentaThreads({ agentId: "agent-1" });
    return <span>{threads.map((thread) => `${thread.id}:${thread.type}`).join(",")}</span>;
}

function CopilotBridge(): ReactNode {
    const { copilotKitProps, status } = useAgenta();
    if (status !== AgentaStatus.Ready) return null;
    return (
        <CopilotKitProvider {...copilotKitProps}>
            <Threads />
        </CopilotKitProvider>
    );
}

afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
});

describe("useAgentaThreads", () => {
    test("preserves the initiation type returned by Agenta", async () => {
        const requests: Array<{ url: string; authorization: string | null }> = [];
        let mints = 0;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            requests.push({
                url,
                authorization: new Headers(init?.headers).get("Authorization"),
            });
            if (url.endsWith("/info")) {
                return Response.json({
                    version: "1.0.0",
                    agents: {},
                    mode: "sse",
                    threadEndpoints: {
                        list: true,
                        inspect: false,
                        mutations: true,
                        realtimeMetadata: false,
                    },
                });
            }
            if (url.includes("/threads?")) {
                return Response.json({
                    threads: [
                        {
                            id: "thread-user",
                            organizationId: "owner-1",
                            agentId: "agent-1",
                            createdById: "customer-1",
                            name: "Asked in the drawer",
                            archived: false,
                            type: "user",
                            createdAt: "2026-09-23T09:00:00.000Z",
                            updatedAt: "2026-09-23T09:00:00.000Z",
                        },
                        {
                            id: "thread-scheduled",
                            organizationId: "owner-1",
                            agentId: "agent-1",
                            createdById: "customer-1",
                            name: "Daily summary",
                            archived: false,
                            type: "scheduled",
                            createdAt: "2026-09-23T08:00:00.000Z",
                            updatedAt: "2026-09-23T08:00:00.000Z",
                        },
                    ],
                    nextCursor: null,
                });
            }
            throw new Error(`Unexpected request: ${url}`);
        }) as typeof globalThis.fetch;

        const view = render(
            <AgentaProvider
                getCredentials={() => {
                    mints += 1;
                    return Promise.resolve({
                        token: `customer-token-${mints}`,
                        expiresAt: new Date(
                            Date.now() + (mints === 1 ? 60 * 1000 : 60 * 60 * 1000),
                        ).toISOString(),
                        agentId: "agent-1",
                    });
                }}
                runtimeUrl="https://runtime.buildagenta.test"
            >
                <CopilotBridge />
            </AgentaProvider>,
        );

        await waitFor(() =>
            expect(view.getByText("thread-user:user,thread-scheduled:scheduled")).toBeTruthy(),
        );
        expect(requests.find((request) => request.url.includes("/threads?"))).toEqual({
            url: "https://runtime.buildagenta.test/threads?agentId=agent-1",
            authorization: "Bearer customer-token-2",
        });
        expect(mints).toBe(2);
    });
});
