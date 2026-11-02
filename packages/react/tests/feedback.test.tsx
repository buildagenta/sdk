// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "bun:test";
import { type BaseEvent, EventType } from "@ag-ui/client";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
    type AgentaAgent,
    AgentaProvider,
    type AgentaRateMessage,
    AgentaStatus,
    useAgenta,
    useAgentaFeedback,
} from "../src/index.js";

const originalFetch = globalThis.fetch;

let agent: AgentaAgent | null = null;
let rate: AgentaRateMessage | undefined;

// A restored conversation of two turns, as agent-run replays it.
const replay: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" },
    { type: EventType.TEXT_MESSAGE_START, messageId: "message-1", role: "assistant" },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message-1", delta: "Booked." },
    { type: EventType.TEXT_MESSAGE_END, messageId: "message-1" },
    { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" },
    { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-2" },
    { type: EventType.TEXT_MESSAGE_START, messageId: "message-2", role: "assistant" },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message-2", delta: "Moved it." },
    { type: EventType.TEXT_MESSAGE_END, messageId: "message-2" },
    { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-2" },
];

function Probe(): ReactNode {
    agent = useAgenta().agent;
    rate = useAgentaFeedback();
    return null;
}

function CopilotBridge(): ReactNode {
    const { copilotKitProps, status } = useAgenta();
    if (status !== AgentaStatus.Ready) return null;
    return (
        <CopilotKitProvider {...copilotKitProps}>
            <Probe />
        </CopilotKitProvider>
    );
}

function renderProbe(): void {
    render(
        <AgentaProvider
            getCredentials={() =>
                Promise.resolve({
                    token: "customer-token",
                    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                    agentId: "agent-1",
                })
            }
            runtimeUrl="https://runtime.buildagenta.test"
        >
            <CopilotBridge />
        </AgentaProvider>,
    );
}

afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    agent = null;
    rate = undefined;
});

describe("useAgentaFeedback", () => {
    test("records feedback on the run that streamed a restored message", async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/info")) return Response.json({ version: "1.0.0", agents: {} });
            if (url.endsWith("/connect")) {
                return new Response(
                    replay.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
                    { headers: { "Content-Type": "text/event-stream" } },
                );
            }
            requests.push({ url, init });
            return Response.json({ ok: true });
        }) as typeof globalThis.fetch;
        renderProbe();
        await waitFor(() => expect(rate).toBeDefined());
        if (!agent) throw new Error("The provider built no agent");
        agent.threadId = "thread-1";
        await agent.connectAgent();

        await rate?.("message-2", { value: 0, rationale: "It booked the wrong day." });

        expect(requests).toHaveLength(1);
        expect(requests[0]?.url).toBe(
            "https://runtime.buildagenta.test/threads/thread-1/runs/run-2/feedback",
        );
        expect(requests[0]?.init?.method).toBe("PUT");
        expect(new Headers(requests[0]?.init?.headers).get("Authorization")).toBe(
            "Bearer customer-token",
        );
        expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
            value: 0,
            rationale: "It booked the wrong day.",
        });
    });

    test("refuses a message no run is known for", async () => {
        globalThis.fetch = (async (
            _input: RequestInfo | URL,
            _init?: RequestInit,
        ): Promise<Response> =>
            Response.json({ version: "1.0.0", agents: {} })) as typeof globalThis.fetch;
        renderProbe();
        await waitFor(() => expect(rate).toBeDefined());

        await expect(rate?.("message-3", { value: 1 })).rejects.toThrow("no known run");
    });
});
