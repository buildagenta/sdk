# Website/App Example

An example website/app that uses the Agenta SDK. It is a runnable Vite app with one
backend endpoint and one React provider, showing how to put an Agenta agent in front of
your own customers.

## The contract

For performance reasons, the chat sidebar connects to Agenta from the browser without
going through a server-side endpoint or proxy. For browsers to authenticate with Agenta,
they use a short-lived JWT token.

Your backend mints one with your Agenta API key, which never leaves the server:

```ts
{
    token: string;
    expiresAt: string;
    agentId: string;
}
```

The endpoint is `POST /api/token` here, and the path is yours to choose — the browser only
has to reach it, and `AssistantProvider` is where it is named.

`AgentaProvider` calls `getCredentials` on mount, and again whenever the token it holds is
spent.

## Files

| File                        | What it is                                                     |
| --------------------------- | -------------------------------------------------------------- |
| `server/agent-token.ts`     | `POST /api/token`. Authenticates the user, mints the token     |
| `src/AssistantProvider.tsx` | `AgentaProvider` + `useAgenta` + CopilotKit                    |
| `src/App.tsx`               | The page, with a full chat and a collapsible sidebar           |
| `src/Chat.tsx`              | CopilotChat with the agent's files, feedback and attachments   |
| `src/Threads.tsx`           | The user's chats and scheduled chats                           |
| `src/Schedules.tsx`         | Creating, pausing and deleting scheduled chats                 |
| `vite.config.ts`            | Mounts the endpoint on the dev server, so there is one process |

## Environment

Server side only — neither belongs in the browser bundle:

| Variable          | What it is                                                           |
| ----------------- | -------------------------------------------------------------------- |
| `AGENTA_API_KEY`  | A standard user API key, minted at <https://app.buildagenta.com/api-keys> |
| `AGENTA_AGENT_ID` | The agent, from its Publish page                                     |

## Running it

```bash
bun install
cp .env.example .env   # then fill both values in
bun run dev
```

The page opens with the agent in the middle and the same conversation in a sidebar you can
hide. Send a message and it appears under Sessions on <https://app.buildagenta.com>, with any 👍
or 👎 under the reply it rates. The sidebar's History lists past chats, including ones a
schedule started, and Schedules sets up messages the agent receives on a cron schedule.

To put this in your own app, mount `handleAgentTokenRequest` at
`https://app.example.com/api/token` wherever your other routes live, and wrap your UI in
`AssistantProvider`.

## Customer values

If your agent's instructions or tools use dynamic variables and secrets — `{customerName}`,
`{serverUrl}`, `{customerToken}` — set them for each customer when you mint that customer's
token:

```ts
await mintAgentToken(user.id, {
    variables: { customerName: user.name, serverUrl: "https://api.example.com" },
    secrets: { customerToken: user.token },
});
```

The agent's tools resolve both by name. Agenta stores them against this customer rather
than putting them in the token, so the browser holding that token can neither read them nor
substitute its own.
