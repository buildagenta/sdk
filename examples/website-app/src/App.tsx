// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The page, standing in for your product.
 *
 * Two chats — the page's own and a sidebar that opens and closes — sit inside one
 * `AssistantProvider` and share a thread id, so they are two views of the same
 * conversation rather than two conversations. The sidebar also holds the user's
 * history and their scheduled chats.
 */

import { AgentaStatus, useAgenta } from "@buildagenta/react";
import { type ReactElement, useState } from "react";

import { AssistantProvider } from "./AssistantProvider.js";
import { Chat } from "./Chat.js";
import { Schedules } from "./Schedules.js";
import { Threads } from "./Threads.js";

type Panel = "chat" | "history" | "schedules";

const PANELS: Array<{ panel: Panel; label: string }> = [
    { panel: "chat", label: "Chat" },
    { panel: "history", label: "History" },
    { panel: "schedules", label: "Schedules" },
];

function Page(): ReactElement {
    const { copilotKitProps, status, error, retry } = useAgenta();
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [panel, setPanel] = useState<Panel>("chat");
    const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());

    if (status === AgentaStatus.Loading) return <p className="notice">Connecting…</p>;
    if (status === AgentaStatus.Error || !copilotKitProps.agent) {
        return (
            <p className="notice">
                {error?.message ?? "Could not reach Agenta"}{" "}
                <button type="button" onClick={retry}>
                    Try again
                </button>
            </p>
        );
    }
    const agentId = copilotKitProps.agent;

    const openThread = (id: string): void => {
        setThreadId(id);
        setPanel("chat");
    };

    return (
        <div className="layout">
            <main className="page">
                <header>
                    <h1>Your product</h1>
                    <button type="button" onClick={() => setSidebarOpen((open) => !open)}>
                        {sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                    </button>
                </header>
                <Chat agentId={agentId} threadId={threadId} />
            </main>

            {sidebarOpen && (
                <aside className="sidebar">
                    <nav className="tabs">
                        {PANELS.map((tab) => (
                            <button
                                key={tab.panel}
                                type="button"
                                aria-pressed={tab.panel === panel}
                                onClick={() => setPanel(tab.panel)}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                    {panel === "chat" && <Chat agentId={agentId} threadId={threadId} />}
                    {panel === "history" && (
                        <Threads
                            agentId={agentId}
                            threadId={threadId}
                            onSelect={openThread}
                            onNew={() => openThread(crypto.randomUUID())}
                        />
                    )}
                    {panel === "schedules" && <Schedules />}
                </aside>
            )}
        </div>
    );
}

export function App(): ReactElement {
    return (
        <AssistantProvider>
            <Page />
        </AssistantProvider>
    );
}
