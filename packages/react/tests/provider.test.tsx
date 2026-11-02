// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "bun:test";
import type { RunAgentInput } from "@ag-ui/client";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
    AGENTA_RUNTIME_URL,
    type AgentaAgent,
    type AgentaContextValue,
    type AgentaCredentials,
    AgentaProvider,
    AgentaStatus,
    useAgenta,
} from "../src/index.js";

const credentials = (overrides: Partial<AgentaCredentials> = {}): AgentaCredentials => ({
    token: "token-1",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    agentId: "agent-1",
    ...overrides,
});

/** Inside the refresh margin, so every request mints before it is sent. */
const nearlySpent = (): string => new Date(Date.now() + 60 * 1000).toISOString();

const spent = (): string => new Date(Date.now() - 1000).toISOString();

const runInput: RunAgentInput = {
    threadId: "thread-1",
    runId: "run-1",
    messages: [{ id: "user-1", role: "user", content: "hello" }],
    tools: [],
    context: [],
    state: {},
};

let current: AgentaContextValue | undefined;

function Probe(): ReactNode {
    current = useAgenta();
    return <span data-testid="status">{current.status}</span>;
}

const originalFetch = globalThis.fetch;

/** Stand in for the network so a run's outgoing request can be read back. */
function captureRequests(): { requests: RequestInit[]; firstSent: Promise<void> } {
    const requests: RequestInit[] = [];
    let sent = (): void => {};
    const firstSent = new Promise<void>((resolve) => {
        sent = resolve;
    });
    globalThis.fetch = ((_url: string, init: RequestInit) => {
        requests.push(init);
        sent();
        return Promise.resolve(
            new Response("", { headers: { "Content-Type": "text/event-stream" } }),
        );
    }) as typeof fetch;
    return { requests, firstSent };
}

afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    current = undefined;
});

describe("AgentaProvider", () => {
    test("always renders children while credentials are loading", () => {
        const view = render(
            <AgentaProvider getCredentials={() => new Promise(() => {})}>
                <Probe />
            </AgentaProvider>,
        );

        expect(view.getByTestId("status").textContent).toBe(AgentaStatus.Loading);
        expect(current?.copilotKitProps).toEqual({});
    });

    test("loads CopilotKit-compatible runtime and self-managed agent properties", async () => {
        render(
            <AgentaProvider getCredentials={() => Promise.resolve(credentials())}>
                <Probe />
            </AgentaProvider>,
        );

        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Ready));
        const props = current?.copilotKitProps;

        expect(props).toMatchObject({
            runtimeUrl: AGENTA_RUNTIME_URL,
            agent: "agent-1",
            headers: { Authorization: "Bearer token-1" },
            useSingleEndpoint: false,
        });
        // The same instance the caller reads directly, so nobody rebuilds their own.
        expect(props?.selfManagedAgents?.["agent-1"]).toBe(current?.agent as AgentaAgent);
        expect(current?.agent?.url).toBe(`${AGENTA_RUNTIME_URL}/agent-1/ag-ui`);
        expect(current?.agent?.headers).toEqual({ Authorization: "Bearer token-1" });
        expect(current?.error).toBeNull();
    });

    test("points at a runtime of the caller's own when one is given", async () => {
        render(
            <AgentaProvider
                getCredentials={() => Promise.resolve(credentials())}
                runtimeUrl="http://localhost:8000/"
            >
                <Probe />
            </AgentaProvider>,
        );

        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Ready));

        // Local development is the whole reason the override exists.
        expect(current?.copilotKitProps.runtimeUrl).toBe("http://localhost:8000/");
        expect(current?.agent?.url).toBe("http://localhost:8000/agent-1/ag-ui");
    });

    test("reads the newest context on every run without replacing the agent", async () => {
        let venue = "The Ivy";
        render(
            <AgentaProvider
                getCredentials={() => Promise.resolve(credentials())}
                getContext={() => ({ "venue-name": venue })}
            >
                <Probe />
            </AgentaProvider>,
        );

        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Ready));
        const agent = current?.agent;
        const calls: RunAgentInput[] = [];
        // biome-ignore lint/suspicious/noExplicitAny: Narrowing the fetch stub is not the point.
        (agent as any).fetch = (_url: string, init: RequestInit) => {
            calls.push(JSON.parse(String(init.body)) as RunAgentInput);
            return new Promise<Response>(() => {});
        };

        agent?.run(runInput).subscribe({ error: () => {} });
        venue = "The Wolseley";
        agent?.run(runInput).subscribe({ error: () => {} });

        expect(calls[0].context).toEqual([{ description: "venue-name", value: "The Ivy" }]);
        expect(calls[1].context).toEqual([{ description: "venue-name", value: "The Wolseley" }]);
        expect(current?.agent).toBe(agent);
    });

    test("exposes credential failures and retries explicitly", async () => {
        let calls = 0;
        const getCredentials = (): Promise<AgentaCredentials> => {
            calls += 1;
            return calls === 1
                ? Promise.reject(new Error("mint failed"))
                : Promise.resolve(credentials());
        };
        render(
            <AgentaProvider getCredentials={getCredentials}>
                <Probe />
            </AgentaProvider>,
        );

        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Error));
        expect(current?.error?.message).toBe("mint failed");

        act(() => current?.retry());
        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Ready));
        expect(calls).toBe(2);
    });

    test("replaces a spent credential without replacing the agent", async () => {
        let calls = 0;
        const getCredentials = (): Promise<AgentaCredentials> => {
            calls += 1;
            return Promise.resolve(
                calls === 1
                    ? credentials({ expiresAt: nearlySpent() })
                    : credentials({ token: "token-2" }),
            );
        };
        render(
            <AgentaProvider getCredentials={getCredentials}>
                <Probe />
            </AgentaProvider>,
        );

        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Ready));
        const firstAgent = current?.copilotKitProps.selfManagedAgents?.["agent-1"] as
            | AgentaAgent
            | undefined;

        await act(async () => {
            await current?.checkAndMintCredentials();
        });

        expect(calls).toBe(2);
        expect(current?.copilotKitProps.headers).toEqual({ Authorization: "Bearer token-2" });
        // The agent owns the conversation, so a new credential must not bring a new one.
        expect(current?.copilotKitProps.selfManagedAgents?.["agent-1"]).toBe(firstAgent);
        expect(firstAgent?.headers).toEqual({ Authorization: "Bearer token-2" });
    });

    test("keeps a working conversation up when a mint fails", async () => {
        let calls = 0;
        const getCredentials = (): Promise<AgentaCredentials> => {
            calls += 1;
            if (calls === 1) return Promise.resolve(credentials({ expiresAt: nearlySpent() }));
            if (calls === 2) return Promise.reject(new Error("mint failed"));
            return Promise.resolve(credentials({ token: "token-3" }));
        };
        render(
            <AgentaProvider getCredentials={getCredentials}>
                <Probe />
            </AgentaProvider>,
        );

        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Ready));
        const agent = current?.agent;

        await act(async () => {
            await current?.checkAndMintCredentials();
        });

        // The failed mint reports itself, but the credential it would have replaced is
        // still valid, so the caller keeps a usable agent rather than an error screen.
        expect(current?.error?.message).toBe("mint failed");
        expect(current?.status).toBe(AgentaStatus.Ready);
        expect(current?.copilotKitProps.headers).toEqual({ Authorization: "Bearer token-1" });

        act(() => current?.retry());
        await waitFor(() =>
            expect(current?.copilotKitProps.headers).toEqual({ Authorization: "Bearer token-3" }),
        );
        expect(current?.agent).toBe(agent);
        expect(current?.error).toBeNull();
    });

    test("signs every agent request with a token minted for it", async () => {
        let calls = 0;
        const getCredentials = (): Promise<AgentaCredentials> => {
            calls += 1;
            return Promise.resolve(
                credentials({ token: `token-${calls}`, expiresAt: nearlySpent() }),
            );
        };
        render(
            <AgentaProvider getCredentials={getCredentials}>
                <Probe />
            </AgentaProvider>,
        );

        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Ready));
        const { requests, firstSent } = captureRequests();

        await act(async () => {
            current?.agent?.run(runInput).subscribe({ error: () => {} });
            await firstSent;
        });

        // The token the request carries is the one the gate minted on the way out, not
        // the one the agent was holding — which is the whole point of gating.
        expect(new Headers(requests[0].headers).get("Authorization")).toBe("Bearer token-2");
    });

    test("sends the credential it has when minting a replacement fails", async () => {
        let calls = 0;
        const getCredentials = (): Promise<AgentaCredentials> => {
            calls += 1;
            return calls === 1
                ? Promise.resolve(credentials({ expiresAt: nearlySpent() }))
                : Promise.reject(new Error("mint failed"));
        };
        render(
            <AgentaProvider getCredentials={getCredentials}>
                <Probe />
            </AgentaProvider>,
        );

        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Ready));
        const { requests, firstSent } = captureRequests();

        await act(async () => {
            current?.agent?.run(runInput).subscribe({ error: () => {} });
            await firstSent;
        });

        expect(new Headers(requests[0].headers).get("Authorization")).toBe("Bearer token-1");
    });

    test("reports an error once the credential is spent, and stops hammering the mint", async () => {
        let calls = 0;
        const getCredentials = (): Promise<AgentaCredentials> => {
            calls += 1;
            return calls === 1
                ? Promise.resolve(credentials({ expiresAt: spent() }))
                : Promise.reject(new Error("mint failed"));
        };
        render(
            <AgentaProvider getCredentials={getCredentials}>
                <Probe />
            </AgentaProvider>,
        );

        // Waited out, so the mint below is its own rather than the one already in flight.
        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Ready));
        await act(async () => {
            await current?.checkAndMintCredentials().catch(() => {});
        });

        expect(current?.status).toBe(AgentaStatus.Error);
        expect(current?.error?.message).toBe("mint failed");

        // The first retry is a second away, so a session that cannot mint stays quiet
        // rather than repeating the request several times a minute for as long as it runs.
        const attempts = calls;
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(calls).toBe(attempts);
    });

    test("recovers from a getCredentials that throws before it returns a promise", async () => {
        let calls = 0;
        const getCredentials = (): Promise<AgentaCredentials> => {
            calls += 1;
            if (calls === 1) throw new Error("no session");
            return Promise.resolve(credentials());
        };
        render(
            <AgentaProvider getCredentials={getCredentials}>
                <Probe />
            </AgentaProvider>,
        );

        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Error));
        expect(current?.error?.message).toBe("no session");

        act(() => current?.retry());
        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Ready));
    });

    test("reports an error when the first load fails, with nothing to fall back on", async () => {
        render(
            <AgentaProvider getCredentials={() => Promise.reject(new Error("mint failed"))}>
                <Probe />
            </AgentaProvider>,
        );

        await waitFor(() => expect(current?.status).toBe(AgentaStatus.Error));
        expect(current?.agent).toBeNull();
    });
});
