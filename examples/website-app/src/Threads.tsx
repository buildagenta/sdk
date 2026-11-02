// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The user's past conversations: the ones they started, and the ones a schedule did.
 */

import { type AgentaThreadType, useAgentaThreads } from "@buildagenta/react";
import { type ReactElement, useState } from "react";

const TABS: Array<{ type: AgentaThreadType; label: string }> = [
    { type: "user", label: "Chats" },
    { type: "scheduled", label: "Scheduled" },
];

export function Threads({
    agentId,
    threadId,
    onSelect,
    onNew,
}: {
    agentId: string;
    threadId: string;
    onSelect: (threadId: string) => void;
    onNew: () => void;
}): ReactElement {
    const { threads, isLoading, error } = useAgentaThreads({ agentId });
    const [type, setType] = useState<AgentaThreadType>("user");
    const shown = threads.filter((thread) => thread.type === type);

    return (
        <section className="panel">
            <div className="tabs">
                {TABS.map((tab) => (
                    <button
                        key={tab.type}
                        type="button"
                        aria-pressed={tab.type === type}
                        onClick={() => setType(tab.type)}
                    >
                        {tab.label}
                    </button>
                ))}
                <button type="button" onClick={onNew}>
                    New chat
                </button>
            </div>
            {error && <p className="notice">{error.message}</p>}
            {isLoading && <p className="notice">Loading…</p>}
            {!isLoading && shown.length === 0 && <p className="notice">Nothing here yet.</p>}
            <ul className="list">
                {shown.map((thread) => (
                    <li key={thread.id}>
                        <button
                            type="button"
                            aria-current={thread.id === threadId}
                            onClick={() => onSelect(thread.id)}
                        >
                            {thread.name ?? "Untitled"}
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
