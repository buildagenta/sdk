// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { useCopilotKit } from "@copilotkit/react-core/v2";
import { useCallback } from "react";

import { useAgenta } from "./provider.js";

/** A thumbs up (1) or down (0), and optionally what the user said about it. */
export interface AgentaFeedback {
    value: 0 | 1;
    rationale?: string | null;
}

/** Records feedback on the turn one message belongs to. */
export type AgentaRateMessage = (messageId: string, feedback: AgentaFeedback) => Promise<void>;

/**
 * Rate the agent's replies, for its owner to read alongside the conversation.
 *
 * Agenta records feedback per turn rather than per message, so every message in one turn
 * shares a rating, and rating any of them again replaces it. Wire it to `CopilotChat`'s
 * thumbs, and call it again with the same value to add text the user writes afterwards.
 */
export function useAgentaFeedback(): AgentaRateMessage {
    const { agent, authenticatedFetch } = useAgenta();
    const { copilotkit } = useCopilotKit();

    return useCallback<AgentaRateMessage>(
        async (messageId, { value, rationale = null }) => {
            const { runtimeUrl } = copilotkit;
            if (!runtimeUrl) throw new Error("Runtime URL is not configured");
            const run = agent?.runForMessage(messageId);
            if (!run) throw new Error(`Message ${messageId} belongs to no known run`);

            const response = await authenticatedFetch(
                `${runtimeUrl.replace(/\/+$/, "")}/threads/${encodeURIComponent(run.threadId)}/runs/${encodeURIComponent(run.runId)}/feedback`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ value, rationale }),
                },
            );
            if (!response.ok) {
                throw new Error(`Agenta feedback request failed with ${response.status}`);
            }
        },
        [agent, authenticatedFetch, copilotkit],
    );
}
