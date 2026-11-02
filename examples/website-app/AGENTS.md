# Applying this example

Instructions for a coding agent adding an Agenta assistant to an existing website
or app. Read `README.md` first for the contract.

## 1. Add the token endpoint

Copy `server/agent-token.ts` into wherever the app keeps its server code, next to
its other routes.

Mount `handleAgentTokenRequest` at `POST /api/token`, passing the app's own
session check as `authenticate`. It has to return the app's own identifier for the
signed-in user — the id the app already uses in its own database — or `null` when
the request carries no session. `vite.config.ts` shows one such mounting, on this
example's dev server.

If the app's framework does not use web `Request`/`Response` (Express, Fastify,
Koa), drop `handleAgentTokenRequest` and call `mintAgentToken(customerId)` from a
handler written in that framework's own style. `mintAgentToken` is the part that
matters; the wrapper is convenience.

Do not expose the endpoint unauthenticated, and do not accept a `customerId` from
the request body. The whole point is that the server decides who the caller is.

## 2. Add the environment variables

`AGENTA_API_KEY` and `AGENTA_AGENT_ID`, as described in `README.md`. Server-side
only: an `AGENTA_API_KEY` that reaches the browser bundle is a leaked credential.
In a framework that prefixes public variables (`NEXT_PUBLIC_`, `VITE_`), neither
takes that prefix.

## 3. Add the provider

```bash
npm install @buildagenta/react @ag-ui/client @copilotkit/react-core @copilotkit/react-ui
```

Copy `src/AssistantProvider.tsx` in and mount it **above** anything that can
unmount — the drawer, modal or route the chat lives in. It holds the agent, which
owns the conversation, so mounting it inside a drawer starts a new thread every
time the drawer closes.

Render CopilotKit's chat UI inside it, as `src/App.tsx` does. `useAgenta` gives you
`copilotKitProps`, `status`, `error` and `retry`; the SDK deliberately does not
mount CopilotKit, so the loading and error UI stays the app's own. Two chats in
one provider are two views of one conversation, which is what makes a full page
and a sidebar agree.

If the app fetches with credentials the browser does not send automatically (a
bearer token from an auth SDK), add them to the `fetch` in `getCredentials` — it is
an ordinary request to the app's own backend.

## 4. Check it

Send a message from the app. The conversation appears under Sessions on
<https://app.buildagenta.com>, and the agent's Publish page reports Website/App as
published once it has.
