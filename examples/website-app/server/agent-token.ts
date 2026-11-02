// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * `POST /api/token` — the one endpoint your backend has to add.
 *
 * The browser connects to Agenta directly, so it needs a credential of its own.
 * Your Agenta API key never leaves the server: this endpoint authenticates the
 * user the way the rest of your app already does, then exchanges the key for a
 * short-lived customer token naming that one user to that one agent.
 *
 * Framework-free on purpose. `mintAgentToken` is the part that matters and drops
 * into anything; `handleAgentTokenRequest` wraps it for any runtime that speaks
 * the web `Request`/`Response` types (Next.js route handlers, Hono, Bun.serve).
 */

const AGENTA_API_URL = "https://app.buildagenta.com/api/v1";

/** Exactly what `@buildagenta/react`'s `getCredentials` has to resolve to. */
export interface AgentToken {
    token: string;
    expiresAt: string;
    agentId: string;
}

/**
 * Per-customer values the agent's tools resolve at run time.
 *
 * Use them to hand the agent this customer's own access to your API, so it acts
 * as them rather than as you.
 */
export interface RequestValues {
    variables?: Record<string, string>;
    secrets?: Record<string, string>;
}

const env = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
};

/**
 * Mints a customer token for one of your users.
 * @param customerId Your own identifier for the user. Agenta stores it as given
 * and never learns anything else about them.
 * @param values Per-customer variables and secrets for this user's runs.
 * @returns The credential `AgentaProvider` expects.
 */
export async function mintAgentToken(
    customerId: string,
    values: RequestValues = {},
): Promise<AgentToken> {
    const agentId = env("AGENTA_AGENT_ID");

    const response = await fetch(`${AGENTA_API_URL}/customer-tokens`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${env("AGENTA_API_KEY")}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ agentId, customerId, ...values }),
    });

    if (!response.ok) {
        throw new Error(`Agenta customer token request failed with ${response.status}`);
    }

    const minted = (await response.json()) as { token: string; expiresAt: string };
    return { ...minted, agentId };
}

/** Resolves the signed-in user, or null when the request carries no session. */
export type Authenticate = (request: Request) => Promise<string | null>;

const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });

/**
 * Builds the route handler.
 * @param authenticate Your own session check, returning the customer id.
 * @returns A handler to mount at `POST /api/token`.
 */
export function handleAgentTokenRequest(
    authenticate: Authenticate,
): (request: Request) => Promise<Response> {
    return async (request: Request): Promise<Response> => {
        const customerId = await authenticate(request);
        if (!customerId) return json({ error: "Unauthorized" }, 401);

        // Whatever this customer's runs need, if the agent's tools take any:
        //   { variables: { serverUrl: API_BASE }, secrets: { customerToken: ... } }
        return json(await mintAgentToken(customerId), 200);
    };
}
