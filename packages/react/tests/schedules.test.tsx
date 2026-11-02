// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
    AgentaProvider,
    type AgentaSchedule,
    type UseAgentaSchedulesResult,
    useAgentaSchedules,
} from "../src/index.js";

const originalFetch = globalThis.fetch;

const SCHEDULE: AgentaSchedule = {
    id: "schedule-1",
    message: "Send me my daily summary",
    cron: "0 8 * * *",
    timeZone: "Europe/London",
    enabled: true,
    sendResponseTo: null,
    nextRunAt: "2026-10-14T07:00:00.000Z",
    lastRunAt: null,
    lastError: null,
    createdAt: "2026-10-13T09:00:00.000Z",
    updatedAt: "2026-10-13T09:00:00.000Z",
};

let current: UseAgentaSchedulesResult | undefined;

function Probe(): ReactNode {
    current = useAgentaSchedules();
    return null;
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
            apiUrl="https://api.buildagenta.test/api/v1"
        >
            <Probe />
        </AgentaProvider>,
    );
}

afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    current = undefined;
});

describe("useAgentaSchedules", () => {
    test("lists, creates, pauses, and deletes the user's schedules", async () => {
        const requests: Array<{ method: string; url: string; body?: unknown }> = [];
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const method = init?.method ?? "GET";
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            requests.push({ method, url: String(input), body });
            if (method === "GET") return Response.json({ schedules: [SCHEDULE] });
            if (method === "POST") return Response.json({ ...SCHEDULE, id: "schedule-2", ...body });
            if (method === "PATCH") return Response.json({ ...SCHEDULE, ...body });
            return new Response(null, { status: 204 });
        }) as typeof globalThis.fetch;
        renderProbe();

        await waitFor(() => expect(current?.schedules).toEqual([SCHEDULE]));
        expect(requests[0]?.url).toBe("https://api.buildagenta.test/api/v1/customer-schedules");

        await act(async () => {
            await current?.createSchedule({ message: "Weekly report", cron: "0 9 * * 1" });
        });
        expect(current?.schedules.map((schedule) => schedule.id)).toEqual([
            "schedule-2",
            "schedule-1",
        ]);
        await act(async () => {
            await current?.updateSchedule("schedule-1", { enabled: false });
        });
        await act(async () => {
            await current?.deleteSchedule("schedule-2");
        });

        expect(requests.slice(1)).toEqual([
            {
                method: "POST",
                url: "https://api.buildagenta.test/api/v1/customer-schedules",
                body: { message: "Weekly report", cron: "0 9 * * 1" },
            },
            {
                method: "PATCH",
                url: "https://api.buildagenta.test/api/v1/customer-schedules/schedule-1",
                body: { enabled: false },
            },
            {
                method: "DELETE",
                url: "https://api.buildagenta.test/api/v1/customer-schedules/schedule-2",
                body: undefined,
            },
        ]);
        expect(current?.schedules).toEqual([{ ...SCHEDULE, enabled: false }]);
    });

    test("reports why Agenta refused a request", async () => {
        globalThis.fetch = (async (
            _input: RequestInfo | URL,
            _init?: RequestInit,
        ): Promise<Response> =>
            Response.json(
                { error: { code: "bad_request", message: "That cron never runs" } },
                { status: 400 },
            )) as typeof globalThis.fetch;
        renderProbe();

        await waitFor(() => expect(current?.error?.message).toBe("That cron never runs"));
        expect(current?.isLoading).toBe(false);
    });
});
