// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { CopilotKitProvider, type CopilotKitProviderProps } from "@copilotkit/react-core/v2";
import type { ReactNode } from "react";

import { AgentaProvider, useAgenta, useAgentaThreads } from "../src/index.js";

function CopilotBridge(): ReactNode {
    const { copilotKitProps } = useAgenta();
    const standardProps: Omit<CopilotKitProviderProps, "children"> = copilotKitProps;
    return <CopilotKitProvider {...standardProps}>chat</CopilotKitProvider>;
}

function Threads(): ReactNode {
    const { threads } = useAgentaThreads({ agentId: "agent" });
    const type: "user" | "scheduled" | undefined = threads[0]?.type;
    return type;
}

export const typeCompatibility = (
    <AgentaProvider
        getCredentials={() =>
            Promise.resolve({
                token: "token",
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                agentId: "agent",
            })
        }
    >
        <CopilotBridge />
        <Threads />
    </AgentaProvider>
);
