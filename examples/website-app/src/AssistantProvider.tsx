// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * The provider that holds the agent, and the CopilotKit it feeds.
 *
 * Mount `AssistantProvider` above anything that can unmount — a drawer, a modal,
 * a route — because it owns the conversation. Closing the UI then leaves the
 * thread alone rather than starting a new one.
 */

import {
    type AgentaCredentials,
    AgentaProvider,
    type AgentaRunContext,
    AgentaStatus,
    useAgenta,
} from "@buildagenta/react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { type ReactNode, useCallback } from "react";

/** The `POST /api/token` endpoint from `server/agent-token.ts`. */
const TOKEN_URL = "/api/token";

/**
 * Mounts CopilotKit once the SDK has a credential.
 *
 * Children render either way, so your own loading and error UI stays visible and
 * the conversation survives a failed token refresh.
 */
function AssistantConversation({ children }: { children: ReactNode }) {
    const { copilotKitProps, status } = useAgenta();

    if (status !== AgentaStatus.Ready) return <>{children}</>;

    return (
        <CopilotKitProvider
            {...copilotKitProps}
            onError={({ error }) => {
                console.error("[assistant]", error);
            }}
        >
            {children}
        </CopilotKitProvider>
    );
}

export function AssistantProvider({ children }: { children: ReactNode }) {
    // Send whatever your backend needs to authenticate the user, exactly as any
    // other request from your app does.
    const getCredentials = useCallback(async (): Promise<AgentaCredentials> => {
        const response = await fetch(TOKEN_URL, { method: "POST" });
        if (!response.ok) {
            throw new Error(`Agent token request failed with ${response.status}`);
        }
        return (await response.json()) as AgentaCredentials;
    }, []);

    // Read once per run, so the agent always sees the page the user is on now
    // rather than the page they were on when the provider mounted.
    const getContext = useCallback(
        (): AgentaRunContext => ({ today: new Date().toISOString().slice(0, 10) }),
        [],
    );

    return (
        <AgentaProvider getCredentials={getCredentials} getContext={getContext}>
            <AssistantConversation>{children}</AssistantConversation>
        </AgentaProvider>
    );
}
