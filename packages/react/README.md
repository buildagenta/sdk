# `@buildagenta/react`

React SDK for [Agenta](https://buildagenta.com). It connects your app to an agent and gives
[CopilotKit](https://www.copilotkit.ai/) everything it needs to render the conversation.

## Install

```bash
npm install @buildagenta/react @ag-ui/client @copilotkit/react-core
```

## Credentials

For performance reasons, the chat connects to Agenta from the browser without going
through a server-side endpoint or proxy. For browsers to authenticate with Agenta, they
use a short-lived JWT token, which your backend mints with your Agenta API key. The key
never leaves the server.

Add an endpoint that authenticates the user, mints a customer token, and returns it along
with the agent it is for. `POST /api/token` is the path this SDK's example uses, and yours
is whatever you name in `getCredentials`:

```ts
{
    token: string;
    expiresAt: string;
    agentId: string;
}
```

The token is minted for one agent, so the server that mints it is the one place that names
it. Requests from the browser go to `https://agent.buildagenta.com`, exported as
`AGENTA_RUNTIME_URL`; pass `runtimeUrl` to the provider to point at a runtime of your own
during local development.

`AgentaProvider` calls `getCredentials` on mount, and again whenever the token it holds is
spent. Send whatever your backend needs to authenticate the user, the same as any other
request to it:

```tsx
import { useCallback } from "react";
import { AgentaProvider, type AgentaCredentials } from "@buildagenta/react";

export function Root() {
    const getCredentials = useCallback(async (): Promise<AgentaCredentials> => {
        const response = await fetch("/api/token", {
            method: "POST",
            headers: { Authorization: `Bearer ${await getAccessToken()}` },
        });
        if (!response.ok) throw new Error(`Credential request failed with ${response.status}`);
        return response.json();
    }, []);

    return (
        <AgentaProvider getCredentials={getCredentials}>
            <App />
        </AgentaProvider>
    );
}
```

Mount the provider above anything that can unmount, such as a drawer. It holds the agent,
which owns the conversation.

A working endpoint and provider, ready to copy, are in
[`examples/website-app`](../../examples/website-app).

### Renewal

A minted token is short-lived, and the provider replaces it for you. It gives the agent a
`fetch` of its own that checks the token and mints a replacement before each request, so a
spent token is replaced by whatever the user does next — sending a message, reconnecting to
a thread, stopping a run. No timer renews one: a background tab or a sleeping machine defers
timers well past a token's life, and a session waiting on one signs its requests with a dead
token.

`status` turns to `Error` only once no usable token is left, so a single failed mint does
not tear down a working conversation.

CopilotKit's thread endpoints build a `fetch` of their own, so use
`useAgentaThreads` for listing and managing conversations. It replaces a spent token before
each request and preserves whether Agenta recorded a conversation as user- or
schedule-initiated:

```tsx
const { threads, archiveThread, deleteThread } = useAgentaThreads({ agentId });
const scheduled = threads.filter((thread) => thread.type === "scheduled");
```

The remaining `useAgenta().checkAndMintCredentials` method is available for custom Agenta
requests the provider and its hooks do not make.

## Rendering the chat

`useAgenta` returns the properties CopilotKit needs, plus the credential's status. The SDK
does not mount CopilotKit, so the loading and error UI stay yours:

```tsx
import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { AgentaStatus, useAgenta } from "@buildagenta/react";

export function App() {
    const { copilotKitProps, status, error, retry } = useAgenta();

    if (status === AgentaStatus.Loading) return <p>Connecting…</p>;
    if (status === AgentaStatus.Error) {
        return <button onClick={retry}>{error?.message ?? "Try again"}</button>;
    }

    return (
        <CopilotKitProvider {...copilotKitProps}>
            <CopilotChat agentId={copilotKitProps.agent} />
        </CopilotKitProvider>
    );
}
```

## Artifacts

Files the agent produces arrive as events rather than messages, so render them yourself.
`useAgentaArtifacts` collects them, keyed by the message each one followed, and
`downloadArtifact` saves one. Render this inside `CopilotKitProvider`:

```tsx
import { useMemo } from "react";
import { downloadArtifact, useAgentaArtifacts } from "@buildagenta/react";
import {
    CopilotChat,
    CopilotChatAssistantMessage,
    useAgent,
    type CopilotChatAssistantMessageProps,
} from "@copilotkit/react-core/v2";

function Chat({ agentId, threadId }: { agentId: string; threadId: string }) {
    const { agent } = useAgent({ agentId, updates: [] });
    const artifacts = useAgentaArtifacts(agent, threadId);

    // Object.assign carries over the slot's static members, which its type requires.
    const assistantMessage = useMemo(
        () =>
            Object.assign(
                (props: CopilotChatAssistantMessageProps) => (
                    <>
                        <CopilotChatAssistantMessage {...props} />
                        {(artifacts.get(props.message.id) ?? []).map((file) => (
                            <button
                                key={file.id}
                                type="button"
                                onClick={() => downloadArtifact(file)}
                            >
                                {file.filename}
                            </button>
                        ))}
                    </>
                ),
                CopilotChatAssistantMessage,
            ),
        [artifacts],
    );

    return <CopilotChat agentId={agentId} threadId={threadId} messageView={{ assistantMessage }} />;
}
```

## Feedback

`useAgentaFeedback` records a 👍 or 👎 on the agent's reply, with optional text, for the
agent's owner to read in the session. Feedback is per turn, so every message in one turn
shares a rating and rating it again replaces it. Wire it to `CopilotChat`'s thumbs:

```tsx
import { useAgentaFeedback } from "@buildagenta/react";
import { CopilotChat } from "@copilotkit/react-core/v2";

function Chat({ agentId, threadId }: { agentId: string; threadId: string }) {
    const rate = useAgentaFeedback();

    return (
        <CopilotChat
            agentId={agentId}
            threadId={threadId}
            messageView={{
                assistantMessage: {
                    onThumbsUp: (message) => void rate(message.id, { value: 1 }),
                    onThumbsDown: (message) => void rate(message.id, { value: 0 }),
                },
            }}
        />
    );
}
```

Call it again with the same value and a `rationale` to add what the user writes afterwards.

## Scheduled chats

`useAgentaSchedules` lists and manages messages Agenta sends the agent on the user's
behalf, on a cron schedule. The customer token names the user and the agent, so neither is
passed:

```tsx
const { schedules, createSchedule, updateSchedule, deleteSchedule } = useAgentaSchedules();

await createSchedule({ message: "Summarize yesterday's bookings", cron: "0 9 * * 1-5" });
await updateSchedule(schedule.id, { enabled: false });
```

A run a schedule starts appears in `useAgentaThreads` with the type `"scheduled"`, and its
reply can also be emailed or posted to Slack through `sendResponseTo`. Email goes to the
user's own address, and `cc` copies in up to ten colleagues at the same company:

```tsx
await updateSchedule(schedule.id, {
    sendResponseTo: { platform: "email", cc: ["sam@example.com"] },
});
```

## Context

Pass `getContext` to tell the agent what the user is looking at. It is read on every run, so
it can return whatever the current page holds:

```tsx
<AgentaProvider getCredentials={getCredentials} getContext={() => ({ "venue-name": venue })}>
```

Context values are prepended to the user's message. The agent sees them and they stay in its
session, but they are not saved to the AG-UI transcript that the user sees.
