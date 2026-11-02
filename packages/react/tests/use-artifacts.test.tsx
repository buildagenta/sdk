// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test } from "bun:test";
import type { AbstractAgent, AgentSubscriber, CustomEvent, Message } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

import {
    AG_UI_ARTIFACT_EVENT_NAME,
    type ReceivedArtifactFile,
    useAgentaArtifacts,
} from "../src/index.js";

const messages: Message[] = [
    { id: "user-1", role: "user", content: "make me a report" },
    { id: "assistant-1", role: "assistant", content: "here you go" },
];

function artifactEvent(filename: string, version: number): CustomEvent {
    return {
        type: EventType.CUSTOM,
        name: AG_UI_ARTIFACT_EVENT_NAME,
        value: {
            filename,
            version,
            artifact: { inlineData: { data: "YSxi", mimeType: "text/csv" } },
        },
    };
}

/** A stand-in for the agent's subscriber list, so a test can emit custom events. */
function fakeAgent(): { agent: AbstractAgent; emit: (event: CustomEvent) => void } {
    const subscribers: AgentSubscriber[] = [];
    const agent = {
        subscribe(subscriber: AgentSubscriber) {
            subscribers.push(subscriber);
            return {
                unsubscribe: () => {
                    subscribers.splice(subscribers.indexOf(subscriber), 1);
                },
            };
        },
    } as unknown as AbstractAgent;

    return {
        agent,
        emit: (event) => {
            for (const subscriber of [...subscribers]) {
                // biome-ignore lint/suspicious/noExplicitAny: Only the two fields the hook reads.
                subscriber.onCustomEvent?.({ event, messages } as any);
            }
        },
    };
}

let current: ReadonlyMap<string, ReceivedArtifactFile[]> | undefined;

function Probe({ agent, threadId }: { agent: AbstractAgent; threadId: string }): ReactNode {
    current = useAgentaArtifacts(agent, threadId);
    return null;
}

afterEach(() => {
    cleanup();
    current = undefined;
});

describe("useAgentaArtifacts", () => {
    test("keys each file by the message it followed, ignoring duplicates on replay", () => {
        const { agent, emit } = fakeAgent();
        render(<Probe agent={agent} threadId="thread-1" />);

        act(() => {
            emit(artifactEvent("report.csv", 1));
            emit(artifactEvent("summary.csv", 1));
            emit(artifactEvent("report.csv", 1));
        });

        expect(current?.get("assistant-1")?.map(({ id }) => id)).toEqual([
            "report.csv_1",
            "summary.csv_1",
        ]);
    });

    test("ignores events that are not artifacts", () => {
        const { agent, emit } = fakeAgent();
        render(<Probe agent={agent} threadId="thread-1" />);

        act(() => {
            emit({ type: EventType.CUSTOM, name: "something.else", value: {} });
            emit(artifactEvent("report.csv", 1));
        });

        expect(current?.get("assistant-1")).toHaveLength(1);
    });

    test("drops files belonging to a thread the caller has left", () => {
        const { agent, emit } = fakeAgent();
        const view = render(<Probe agent={agent} threadId="thread-1" />);

        act(() => emit(artifactEvent("report.csv", 1)));
        expect(current?.size).toBe(1);

        view.rerender(<Probe agent={agent} threadId="thread-2" />);

        expect(current?.size).toBe(0);
    });
});
