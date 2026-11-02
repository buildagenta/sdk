// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import {
    type BaseEvent,
    EventType,
    type HttpAgentFetchFn,
    type InputContent,
    type RunAgentInput,
} from "@ag-ui/client";
import { lastValueFrom, toArray } from "rxjs";

import { AgentaAgent, type AgentaRunContext } from "../src/index.js";

interface FetchCall {
    url: string;
    init: RequestInit;
}

interface PendingResponse {
    controller: ReadableStreamDefaultController<Uint8Array>;
    response: Response;
}

type ConnectableAgent = AgentaAgent & {
    connect: (input: RunAgentInput) => ReturnType<AgentaAgent["run"]>;
};

const encoder = new TextEncoder();

const input: RunAgentInput = {
    threadId: "thread-1",
    runId: "run-1",
    messages: [
        { id: "user-1", role: "user", content: "first question" },
        { id: "assistant-1", role: "assistant", content: "first answer" },
        { id: "user-2", role: "user", content: "second question" },
    ],
    tools: [],
    context: [],
    state: {},
};

function pendingResponse(): PendingResponse {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const response = new Response(
        new ReadableStream<Uint8Array>({
            start(nextController) {
                controller = nextController;
            },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
    );
    if (!controller) throw new Error("Stream controller was not initialized");
    return { controller, response };
}

function writeEvent(
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: BaseEvent,
): void {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

function eventResponse(events: BaseEvent[]): Response {
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "Content-Type": "text/event-stream" },
    });
}

function makeAgent(fetch: HttpAgentFetchFn, getContext?: () => AgentaRunContext): AgentaAgent {
    const agent = new AgentaAgent({
        agentId: "agent-1",
        url: "https://runtime.example/agent-1/ag-ui",
        getContext,
    });
    agent.fetch = fetch;
    return agent;
}

describe("AgentaAgent", () => {
    test("sends only the trailing user turn while retaining the local transcript", () => {
        const pending = pendingResponse();
        const calls: FetchCall[] = [];
        const agent = makeAgent((url, init) => {
            calls.push({ url, init });
            return Promise.resolve(pending.response);
        });

        const subscription = agent.run(input).subscribe({ error: () => {} });
        const body = JSON.parse(String(calls[0].init.body)) as RunAgentInput;

        expect(body.messages).toEqual([input.messages[2]]);
        expect(agent.messages).toEqual([]);
        expect(input.messages).toHaveLength(3);
        subscription.unsubscribe();
    });

    test("sends the caller's context beside the conversation, reading it per run", () => {
        const pending = pendingResponse();
        const calls: FetchCall[] = [];
        let venue = "The Ivy";
        const agent = makeAgent(
            (url, init) => {
                calls.push({ url, init });
                return Promise.resolve(pending.response);
            },
            () => ({ "venue-name": venue, today: "2026-08-11", zone: "", floor: null }),
        );

        const first = agent.run(input).subscribe({ error: () => {} });
        venue = "The Wolseley";
        const second = agent.run(input).subscribe({ error: () => {} });

        // Empty values are dropped, so a caller passes its page straight through.
        expect((JSON.parse(String(calls[0].init.body)) as RunAgentInput).context).toEqual([
            { description: "venue-name", value: "The Ivy" },
            { description: "today", value: "2026-08-11" },
        ]);
        expect((JSON.parse(String(calls[1].init.body)) as RunAgentInput).context).toContainEqual({
            description: "venue-name",
            value: "The Wolseley",
        });

        first.unsubscribe();
        second.unsubscribe();
    });

    test("leaves a run untouched when the caller supplies no context", () => {
        const pending = pendingResponse();
        const calls: FetchCall[] = [];
        const agent = makeAgent((url, init) => {
            calls.push({ url, init });
            return Promise.resolve(pending.response);
        });

        const subscription = agent.run(input).subscribe({ error: () => {} });

        expect((JSON.parse(String(calls[0].init.body)) as RunAgentInput).context).toEqual([]);
        subscription.unsubscribe();
    });

    test("keeps CopilotKit's complete transcript after a run", async () => {
        const calls: FetchCall[] = [];
        const events: BaseEvent[] = [
            { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" },
            { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" },
        ];
        const agent = makeAgent((url, init) => {
            calls.push({ url, init });
            return Promise.resolve(eventResponse(events));
        });
        agent.threadId = input.threadId;
        agent.setMessages(input.messages);

        await agent.runAgent({ runId: input.runId });
        const body = JSON.parse(String(calls[0].init.body)) as RunAgentInput;

        expect(body.messages).toEqual([input.messages[2]]);
        expect(agent.messages).toEqual(input.messages);
    });

    test("preserves every attachment and content part in the trailing turn", () => {
        const pending = pendingResponse();
        const calls: FetchCall[] = [];
        const agent = makeAgent((url, init) => {
            calls.push({ url, init });
            return Promise.resolve(pending.response);
        });
        const content: InputContent[] = [
            { type: "text" as const, text: "Review these" },
            {
                type: "image" as const,
                source: { type: "data", mimeType: "image/png", value: "aW1hZ2U=" },
                metadata: { filename: "chart.png" },
            },
            {
                type: "document" as const,
                source: {
                    type: "data",
                    mimeType: "application/pdf",
                    value: "cGRm",
                },
                metadata: { filename: "report.pdf" },
            },
        ];
        const attachmentInput: RunAgentInput = {
            ...input,
            messages: [...input.messages, { id: "user-3", role: "user", content }],
        };

        const subscription = agent.run(attachmentInput).subscribe({ error: () => {} });
        const body = JSON.parse(String(calls[0].init.body)) as RunAgentInput;
        const lastMessage = attachmentInput.messages.at(-1);
        if (!lastMessage) throw new Error("Missing attachment message");

        expect(body.messages).toEqual([lastMessage]);
        subscription.unsubscribe();
    });

    test("reconnects through /connect and applies replayed history", async () => {
        const messages = [
            { id: "user-1", role: "user" as const, content: "hello" },
            { id: "assistant-1", role: "assistant" as const, content: "hi" },
        ];
        const calls: FetchCall[] = [];
        const events: BaseEvent[] = [
            { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" },
            { type: EventType.MESSAGES_SNAPSHOT, messages },
            { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" },
        ];
        const agent = makeAgent((url, init) => {
            calls.push({ url, init });
            return Promise.resolve(eventResponse(events));
        });
        agent.threadId = "thread-1";

        await agent.connectAgent();

        expect(calls[0].url).toBe("https://runtime.example/agent-1/ag-ui/connect");
        expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ threadId: "thread-1" });
        expect(agent.messages).toEqual(messages);

        // A finished replay leaves nothing to stop, so Stop issues no request.
        await agent.cancelRun();
        expect(calls).toHaveLength(1);
    });

    test("replaces existing local state when replaying a durable thread", async () => {
        const events: BaseEvent[] = [
            {
                type: EventType.RUN_STARTED,
                threadId: "thread-1",
                runId: "run-1",
                input: {
                    ...input,
                    messages: [input.messages[0]],
                },
            },
            {
                type: EventType.TEXT_MESSAGE_START,
                messageId: "assistant-1",
                role: "assistant",
            },
            {
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId: "assistant-1",
                delta: "first answer",
            },
            { type: EventType.TEXT_MESSAGE_END, messageId: "assistant-1" },
            { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" },
        ];
        const agent = makeAgent(() => Promise.resolve(eventResponse(events)));
        agent.threadId = "thread-1";
        agent.setMessages([
            input.messages[0],
            { id: "assistant-1", role: "assistant", content: "first answer" },
        ]);
        agent.setState({ stale: true });

        await agent.connectAgent();

        expect(agent.messages).toEqual([
            input.messages[0],
            { id: "assistant-1", role: "assistant", content: "first answer" },
        ]);
        expect(agent.state).toEqual({});
    });

    test("shows cached thread messages while durable history reconnects", async () => {
        const pending = pendingResponse();
        const calls: FetchCall[] = [];
        const cachedMessages = [
            { id: "user-1", role: "user" as const, content: "cached question" },
            { id: "assistant-1", role: "assistant" as const, content: "cached answer" },
        ];
        const durableMessages = [
            ...cachedMessages,
            { id: "user-2", role: "user" as const, content: "new question" },
        ];
        const agent = makeAgent((url, init) => {
            calls.push({ url, init });
            return Promise.resolve(pending.response);
        });
        agent.threadId = "thread-1";
        agent.setMessages(cachedMessages);
        agent.threadId = "thread-2";
        agent.setMessages([{ id: "other", role: "user", content: "other thread" }]);
        agent.threadId = "thread-1";
        agent.setMessages([]);

        const connection = agent.connectAgent();

        expect(agent.messages).toEqual(cachedMessages);
        await Bun.sleep(0);
        expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ messages: [] });

        writeEvent(pending.controller, {
            type: EventType.RUN_STARTED,
            threadId: "thread-1",
            runId: "run-1",
        });
        writeEvent(pending.controller, {
            type: EventType.MESSAGES_SNAPSHOT,
            messages: durableMessages,
        });
        writeEvent(pending.controller, {
            type: EventType.RUN_FINISHED,
            threadId: "thread-1",
            runId: "run-1",
        });
        pending.controller.close();
        await connection;

        expect(agent.messages).toEqual(durableMessages);
    });

    test("cancels a run discovered during reconnection", async () => {
        const pending = pendingResponse();
        const calls: FetchCall[] = [];
        const agent = makeAgent((url, init) => {
            calls.push({ url, init });
            return Promise.resolve(
                url.endsWith("/cancel") ? new Response(null, { status: 204 }) : pending.response,
            );
        }) as ConnectableAgent;
        agent.headers = { Authorization: "Bearer token" };

        const subscription = agent.connect(input).subscribe({ error: () => {} });
        writeEvent(pending.controller, {
            type: EventType.RUN_STARTED,
            threadId: "thread-1",
            runId: "reconnected-run",
        });
        await Bun.sleep(0);
        await agent.cancelRun();

        expect(calls.at(-1)).toMatchObject({
            url: "https://runtime.example/agent-1/ag-ui/cancel",
            init: {
                method: "POST",
                body: JSON.stringify({ threadId: "thread-1", runId: "reconnected-run" }),
                keepalive: true,
            },
        });
        expect(calls.at(-1)?.init.headers).toMatchObject({
            Authorization: "Bearer token",
            "Content-Type": "application/json",
        });
        subscription.unsubscribe();
    });

    test("durably cancels before aborting the local stream", async () => {
        const pending = pendingResponse();
        const calls: FetchCall[] = [];
        const agent = makeAgent((url, init) => {
            calls.push({ url, init });
            return Promise.resolve(
                url.endsWith("/cancel") ? new Response(null, { status: 204 }) : pending.response,
            );
        });
        const subscription = agent.run(input).subscribe({ error: () => {} });

        agent.abortRun();
        await Bun.sleep(0);

        expect(calls.map(({ url }) => url)).toEqual([
            "https://runtime.example/agent-1/ag-ui",
            "https://runtime.example/agent-1/ag-ui/cancel",
        ]);
        expect(calls[0].init.signal?.aborted).toBe(true);

        // The run is already cancelled, so a second Stop issues no further request.
        await agent.cancelRun();
        expect(calls).toHaveLength(2);
        subscription.unsubscribe();
    });

    test("does not cancel a completed run", async () => {
        const calls: FetchCall[] = [];
        const events: BaseEvent[] = [
            { type: EventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" },
            { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" },
        ];
        const agent = makeAgent((url, init) => {
            calls.push({ url, init });
            return Promise.resolve(eventResponse(events));
        });

        await lastValueFrom(agent.run(input).pipe(toArray()));
        await agent.cancelRun();

        expect(calls.map(({ url }) => url)).toEqual(["https://runtime.example/agent-1/ag-ui"]);
    });

    test("ignores delayed events after a newer run becomes active", async () => {
        const first = pendingResponse();
        const second = pendingResponse();
        const calls: FetchCall[] = [];
        let request = 0;
        const agent = makeAgent((url, init) => {
            calls.push({ url, init });
            if (url.endsWith("/cancel"))
                return Promise.resolve(new Response(null, { status: 204 }));
            request += 1;
            return Promise.resolve(request === 1 ? first.response : second.response);
        });
        const oldEvents: BaseEvent[] = [];
        const firstSubscription = agent.run(input).subscribe((event) => oldEvents.push(event));
        const secondSubscription = agent
            .run({ ...input, threadId: "thread-2", runId: "run-2" })
            .subscribe({ error: () => {} });

        writeEvent(first.controller, {
            type: EventType.RUN_FINISHED,
            threadId: "thread-1",
            runId: "run-1",
        });
        await Bun.sleep(0);
        await agent.cancelRun();

        expect(oldEvents).toEqual([]);
        expect(JSON.parse(String(calls.at(-1)?.init.body))).toEqual({
            threadId: "thread-2",
            runId: "run-2",
        });
        firstSubscription.unsubscribe();
        secondSubscription.unsubscribe();
    });
});
