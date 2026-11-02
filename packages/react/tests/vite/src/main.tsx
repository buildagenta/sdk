import { AgentaProvider, AgentaStatus, useAgenta } from "@buildagenta/react";
import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function Chat() {
    const { copilotKitProps, status } = useAgenta();
    if (status !== AgentaStatus.Ready) return <span>{status}</span>;

    return (
        <CopilotKitProvider {...copilotKitProps}>
            <CopilotChat agentId={copilotKitProps.agent} />
        </CopilotKitProvider>
    );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

createRoot(root).render(
    <StrictMode>
        <AgentaProvider
            getCredentials={() =>
                Promise.resolve({
                    token: "browser-token",
                    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                    agentId: "agent-1",
                    runtimeUrl: "https://runtime.example",
                })
            }
        >
            <Chat />
        </AgentaProvider>
    </StrictMode>,
);
