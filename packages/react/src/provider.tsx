// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import type { CopilotKitProviderProps } from "@copilotkit/react-core/v2";
import {
    type ReactElement,
    type ReactNode,
    createContext,
    createElement,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import { AgentaAgent, type AgentaRunContext } from "./agent.js";

/** Life left below which a credential is replaced rather than used. */
const MINT_MARGIN_MS = 5 * 60 * 1000;

/**
 * Delays between failed mints, after which only an action mints again.
 *
 * A caller that cannot mint at all must not keep asking for as long as its tab stays open,
 * so the ladder gives a transient failure several quick chances and then stops.
 */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000];

/** Where Agenta runs agents. Fixed, so minting a token cannot change it. */
export const AGENTA_RUNTIME_URL = "https://agent.buildagenta.com";
/** Agenta's own API, which holds what a customer sets up around their conversations. */
export const AGENTA_API_URL = "https://app.buildagenta.com/api/v1";

/** Credentials minted by an application's backend for direct Agenta access. */
export interface AgentaCredentials {
    token: string;
    expiresAt: string;
    /** The token is minted for one agent, so the server that mints it names it. */
    agentId: string;
}

/** Runtime values returned for a normal CopilotKit provider. */
export interface AgentaCopilotKitProps
    extends Omit<CopilotKitProviderProps, "children" | "runtimeUrl"> {
    runtimeUrl?: string;
    /** The agent name used by CopilotKit integrations that support a default agent prop. */
    agent?: string;
}

/** Agenta credential lifecycle states. */
export const AgentaStatus = {
    Loading: "loading",
    Ready: "ready",
    Error: "error",
} as const;

/** The current Agenta credential lifecycle state. */
export type AgentaStatus = (typeof AgentaStatus)[keyof typeof AgentaStatus];

/** Properties accepted by {@link AgentaProvider}. */
export interface AgentaProviderProps {
    children: ReactNode;
    getCredentials: () => Promise<AgentaCredentials>;
    /** Read on every run, so a caller may return whatever its current page holds. */
    getContext?: () => AgentaRunContext;
    /** Overridden only for local development against a runtime of your own. */
    runtimeUrl?: string;
    /** Overridden only for local development against an API of your own. */
    apiUrl?: string;
}

/** Values exposed by {@link useAgenta}. */
export interface AgentaContextValue {
    agent: AgentaAgent | null;
    copilotKitProps: AgentaCopilotKitProps;
    status: AgentaStatus;
    /** A failed refresh reports its error while the current credential keeps working. */
    error: Error | null;
    retry: () => void;
    /** Fetch with a current customer credential. */
    authenticatedFetch: AgentaFetch;
    apiUrl: string;
    /**
     * Replace the current credential if it is spent, and resolve once one is usable.
     *
     * The provider runs this ahead of every request the agent makes, so it is only worth
     * calling for requests the provider does not make: CopilotKit's thread endpoints
     * build a `fetch` of their own, and carry whatever token the last render gave them.
     */
    checkAndMintCredentials: () => Promise<void>;
}

/** A browser-compatible fetch function authenticated with an Agenta customer token. */
export type AgentaFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ProviderState {
    agent: AgentaAgent | null;
    credentials: AgentaCredentials | null;
    status: AgentaStatus;
    error: Error | null;
}

const AgentaContext = createContext<AgentaContextValue | null>(null);

function errorFrom(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}

/** Milliseconds of life left in a credential; zero for one already spent or unreadable. */
function expiresIn(credentials: AgentaCredentials): number {
    const remaining = new Date(credentials.expiresAt).getTime() - Date.now();
    return Number.isFinite(remaining) ? Math.max(remaining, 0) : 0;
}

function agentUrl(runtimeUrl: string, agentId: string): string {
    return `${runtimeUrl.replace(/\/+$/, "")}/${agentId}/ag-ui`;
}

/**
 * Load and replace Agenta credentials while keeping one agent instance alive.
 *
 * The provider gives the agent a `fetch` of its own, so `checkAndMintCredentials` runs
 * ahead of every request the agent makes and a spent token is replaced by the next thing
 * the user does. No timer renews one: a background tab or a sleeping machine defers timers
 * well past a token's life, and a session waiting on one signs its requests with a dead
 * token and reads back a 401.
 *
 * The provider only supplies integration state; it always renders its children and
 * never mounts CopilotKit or application UI itself.
 */
export function AgentaProvider({
    children,
    getCredentials,
    getContext,
    runtimeUrl = AGENTA_RUNTIME_URL,
    apiUrl = AGENTA_API_URL,
}: AgentaProviderProps): ReactElement {
    const agentRef = useRef<AgentaAgent | null>(null);
    const getContextRef = useRef(getContext);
    const getCredentialsRef = useRef(getCredentials);
    const credentialsRef = useRef<AgentaCredentials | null>(null);
    const pendingRef = useRef<Promise<AgentaCredentials> | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const attemptRef = useRef(0);
    const activeRef = useRef(true);
    // The agent's fetch mints through `checkAndMintCredentials`, which is defined after
    // the agent that uses it; the ref ties that knot without rebuilding either one.
    const checkAndMintRef = useRef<() => Promise<AgentaCredentials>>(() =>
        Promise.reject(new Error("Agenta credentials are not loading yet")),
    );
    const [state, setState] = useState<ProviderState>({
        agent: null,
        credentials: null,
        status: AgentaStatus.Loading,
        error: null,
    });

    // Held in refs so a request mints with the newest inputs without the provider
    // having to rebuild the agent whenever the caller's page changes.
    useEffect(() => {
        getContextRef.current = getContext;
    }, [getContext]);
    useEffect(() => {
        getCredentialsRef.current = getCredentials;
    }, [getCredentials]);

    const schedule = useCallback((delay: number, action: () => void): void => {
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(action, Math.max(delay, 0));
    }, []);

    const authenticatedFetch = useCallback<AgentaFetch>(async (input, init) => {
        const { token } = await checkAndMintRef.current();
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${token}`);
        return globalThis.fetch(input, { ...init, headers });
    }, []);

    const buildAgent = useCallback(
        (credentials: AgentaCredentials): AgentaAgent => {
            const headers = { Authorization: `Bearer ${credentials.token}` };
            const url = agentUrl(runtimeUrl, credentials.agentId);
            const agent =
                agentRef.current ??
                new AgentaAgent({
                    agentId: credentials.agentId,
                    url,
                    headers,
                    fetch: authenticatedFetch,
                    getContext: () => getContextRef.current?.() ?? {},
                });
            agentRef.current = agent;
            agent.agentId = credentials.agentId;
            agent.url = url;
            agent.headers = headers;
            return agent;
        },
        [authenticatedFetch, runtimeUrl],
    );

    // One mint at a time, cleared through `finally` on the promise rather than inside
    // the body: a `getCredentials` that throws synchronously would otherwise run the
    // body to completion before the assignment, pinning that failure here for every
    // later request to read back.
    const load = useCallback((): Promise<AgentaCredentials> => {
        pendingRef.current ??= (async (): Promise<AgentaCredentials> => {
            try {
                const credentials = await getCredentialsRef.current();
                if (!activeRef.current) return credentials;

                attemptRef.current = 0;
                credentialsRef.current = credentials;
                setState({
                    agent: buildAgent(credentials),
                    credentials,
                    status: AgentaStatus.Ready,
                    error: null,
                });
                clearTimeout(timerRef.current);
                return credentials;
            } catch (value) {
                const error = errorFrom(value);
                if (!activeRef.current) throw error;

                // A credential with life left in it keeps the conversation up; a spent
                // one has to say so, because every request it signs now reads back 401.
                const current = credentialsRef.current;
                setState((previous) => ({
                    ...previous,
                    status:
                        current && expiresIn(current) > 0 ? previous.status : AgentaStatus.Error,
                    error,
                }));

                const delay = RETRY_DELAYS_MS[attemptRef.current];
                if (delay !== undefined) {
                    attemptRef.current += 1;
                    schedule(delay, () => {
                        void checkAndMintRef.current().catch(() => {});
                    });
                }
                throw error;
            }
        })().finally(() => {
            pendingRef.current = null;
        });
        return pendingRef.current;
    }, [buildAgent, schedule]);

    const checkAndMintCredentials = useCallback(async (): Promise<AgentaCredentials> => {
        const current = credentialsRef.current;
        if (current && expiresIn(current) > MINT_MARGIN_MS) return current;

        try {
            return await load();
        } catch (error) {
            // A mint that fails while the credential it replaces is still good must not
            // fail the request that triggered it.
            if (current && expiresIn(current) > 0) return current;
            throw error;
        }
    }, [load]);
    checkAndMintRef.current = checkAndMintCredentials;

    // Exposed separately so it keeps a stable identity a caller can put in a dependency
    // array, and so the credential itself stays inside the provider.
    const checkAndMintCredentialsVoid = useCallback(async (): Promise<void> => {
        await checkAndMintCredentials();
    }, [checkAndMintCredentials]);

    const retry = useCallback((): void => {
        attemptRef.current = 0;
        setState((previous) => ({ ...previous, error: null }));
        void load().catch(() => {});
    }, [load]);

    useEffect(() => {
        activeRef.current = true;
        void checkAndMintRef.current().catch(() => {});
        return () => {
            activeRef.current = false;
            clearTimeout(timerRef.current);
        };
    }, []);

    const { agent, credentials } = state;
    const agentId = credentials?.agentId;
    const selfManagedAgents = useMemo(
        () => (agent && agentId ? { [agentId]: agent } : undefined),
        [agent, agentId],
    );
    const copilotKitProps = useMemo<AgentaCopilotKitProps>(() => {
        if (!agent || !credentials || !selfManagedAgents) return {};
        return {
            runtimeUrl,
            agent: credentials.agentId,
            headers: { Authorization: `Bearer ${credentials.token}` },
            useSingleEndpoint: false,
            selfManagedAgents,
        };
    }, [agent, credentials, runtimeUrl, selfManagedAgents]);
    const context = useMemo<AgentaContextValue>(
        () => ({
            agent,
            copilotKitProps,
            status: state.status,
            error: state.error,
            retry,
            authenticatedFetch,
            apiUrl,
            checkAndMintCredentials: checkAndMintCredentialsVoid,
        }),
        [
            agent,
            apiUrl,
            authenticatedFetch,
            checkAndMintCredentialsVoid,
            copilotKitProps,
            retry,
            state.error,
            state.status,
        ],
    );

    return createElement(AgentaContext.Provider, { value: context }, children);
}

/** Read the nearest Agenta provider's CopilotKit properties and credential status. */
export function useAgenta(): AgentaContextValue {
    const context = useContext(AgentaContext);
    if (!context) throw new Error("useAgenta must be used within an AgentaProvider");
    return context;
}
