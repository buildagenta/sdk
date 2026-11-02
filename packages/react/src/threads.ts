// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import {
    CopilotKitCoreRuntimeConnectionStatus,
    type ɵThreadRuntimeContext,
    type ɵThreadStore,
    ɵcreateThreadStore,
    ɵselectFetchMoreError,
    ɵselectHasNextPage,
    ɵselectIsFetchingNextPage,
    ɵselectIsMutating,
    ɵselectThreads,
    ɵselectThreadsError,
    ɵselectThreadsIsLoading,
} from "@copilotkit/core";
import {
    type Thread,
    type UseThreadsInput,
    type UseThreadsResult,
    useCopilotKit,
} from "@copilotkit/react-core/v2";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useAgenta } from "./provider.js";

/** How an Agenta conversation was started. */
export type AgentaThreadType = "user" | "scheduled";

/** A CopilotKit conversation with its Agenta initiation type. */
export interface AgentaThread extends Thread {
    type: AgentaThreadType;
}

/** Configuration for {@link useAgentaThreads}. */
export type UseAgentaThreadsInput = UseThreadsInput;

/** Thread state and operations returned by {@link useAgentaThreads}. */
export type UseAgentaThreadsResult = Omit<UseThreadsResult, "threads"> & {
    threads: AgentaThread[];
};

function useThreadStoreSelector<T>(
    store: ɵThreadStore,
    selector: (state: ReturnType<ɵThreadStore["getState"]>) => T,
): T {
    return useSyncExternalStore(
        useCallback(
            (onStoreChange: () => void) => {
                const subscription = store.select(selector).subscribe(onStoreChange);
                return (): void => subscription.unsubscribe();
            },
            [store, selector],
        ),
        () => selector(store.getState()),
        () => selector(store.getServerState()),
    );
}

/**
 * List and manage Agenta threads without dropping their initiation type.
 *
 * CopilotKit's thread store retains additional runtime fields, but its React hook
 * projects them onto CopilotKit's narrower public type. This hook uses the same store
 * and operations while carrying Agenta's `type` through to the caller.
 */
export function useAgentaThreads({
    agentId,
    includeArchived,
    limit,
    enabled = true,
}: UseAgentaThreadsInput): UseAgentaThreadsResult {
    const { authenticatedFetch } = useAgenta();
    const { copilotkit } = useCopilotKit();
    const [store] = useState(() =>
        ɵcreateThreadStore({ fetch: authenticatedFetch as typeof globalThis.fetch }),
    );

    const coreThreads = useThreadStoreSelector(store, ɵselectThreads);
    const threads = useMemo<AgentaThread[]>(
        () =>
            coreThreads.map((thread) => {
                const typed = thread as typeof thread & { type: AgentaThreadType };
                return {
                    id: typed.id,
                    agentId: typed.agentId,
                    name: typed.name,
                    archived: typed.archived,
                    createdAt: typed.createdAt,
                    updatedAt: typed.updatedAt,
                    type: typed.type,
                    ...(typed.lastRunAt !== undefined ? { lastRunAt: typed.lastRunAt } : {}),
                };
            }),
        [coreThreads],
    );
    const storeIsLoading = useThreadStoreSelector(store, ɵselectThreadsIsLoading);
    const storeError = useThreadStoreSelector(store, ɵselectThreadsError);
    const fetchMoreError = useThreadStoreSelector(store, ɵselectFetchMoreError);
    const hasMoreThreads = useThreadStoreSelector(store, ɵselectHasNextPage);
    const isFetchingMoreThreads = useThreadStoreSelector(store, ɵselectIsFetchingNextPage);
    const isMutating = useThreadStoreSelector(store, ɵselectIsMutating);
    const runtimeStatus = copilotkit.runtimeConnectionStatus;
    const threadListEndpointSupported = copilotkit.threadEndpoints?.list !== false;
    const threadMutationsSupported = copilotkit.threadEndpoints?.mutations !== false;
    const threadEndpointsUnavailable =
        Boolean(copilotkit.runtimeUrl) &&
        runtimeStatus === CopilotKitCoreRuntimeConnectionStatus.Connected &&
        !threadListEndpointSupported;
    const runtimeError = useMemo(
        () => (copilotkit.runtimeUrl ? null : new Error("Runtime URL is not configured")),
        [copilotkit.runtimeUrl],
    );
    const threadEndpointsError = useMemo(
        () =>
            threadEndpointsUnavailable
                ? new Error("Thread endpoints are not available on this CopilotKit runtime")
                : null,
        [threadEndpointsUnavailable],
    );
    const threadMutationsError = useMemo(
        () =>
            threadMutationsSupported
                ? null
                : new Error("Thread mutations are not available on this CopilotKit runtime"),
        [threadMutationsSupported],
    );
    const [hasDispatchedContext, setHasDispatchedContext] = useState(false);
    const [configErrorDismissed, setConfigErrorDismissed] = useState(false);

    // biome-ignore lint/correctness/useExhaustiveDependencies: A new config error must be shown.
    useEffect(() => setConfigErrorDismissed(false), [runtimeError, threadEndpointsError]);

    const activeRuntimeError = configErrorDismissed ? null : runtimeError;
    const activeThreadEndpointsError = configErrorDismissed ? null : threadEndpointsError;
    const preConnectLoading =
        enabled &&
        Boolean(copilotkit.runtimeUrl) &&
        !threadEndpointsUnavailable &&
        !hasDispatchedContext;
    const isLoading =
        activeRuntimeError || activeThreadEndpointsError
            ? false
            : preConnectLoading || storeIsLoading;
    const error = activeRuntimeError ?? activeThreadEndpointsError ?? storeError;

    useEffect(() => {
        store.start();
        return (): void => store.stop();
    }, [store]);

    useEffect(() => {
        if (!enabled) return;
        copilotkit.registerThreadStore(agentId, store);
        return (): void => copilotkit.unregisterThreadStore(agentId);
    }, [agentId, copilotkit, enabled, store]);

    useEffect(() => {
        if (!enabled || !copilotkit.runtimeUrl) {
            store.setContext(null);
            setHasDispatchedContext(false);
            return;
        }
        if (runtimeStatus !== CopilotKitCoreRuntimeConnectionStatus.Connected) return;
        if (!threadListEndpointSupported) {
            store.setContext(null);
            setHasDispatchedContext(false);
            return;
        }

        const context: ɵThreadRuntimeContext = {
            runtimeUrl: copilotkit.runtimeUrl,
            headers: { ...copilotkit.headers },
            wsUrl: copilotkit.intelligence?.wsUrl,
            agentId,
            includeArchived,
            limit,
        };
        store.setContext(context);
        setHasDispatchedContext(true);
    }, [
        agentId,
        copilotkit.headers,
        copilotkit.intelligence?.wsUrl,
        copilotkit.runtimeUrl,
        enabled,
        includeArchived,
        limit,
        runtimeStatus,
        store,
        threadListEndpointSupported,
    ]);

    const guardMutation = useCallback(
        <TArgs extends unknown[]>(
            mutation: (...args: TArgs) => Promise<void>,
        ): ((...args: TArgs) => Promise<void>) =>
            (...args: TArgs): Promise<void> =>
                threadMutationsError ? Promise.reject(threadMutationsError) : mutation(...args),
        [threadMutationsError],
    );
    const renameThread = useMemo(
        () => guardMutation((threadId: string, name: string) => store.renameThread(threadId, name)),
        [guardMutation, store],
    );
    const archiveThread = useMemo(
        () => guardMutation((threadId: string) => store.archiveThread(threadId)),
        [guardMutation, store],
    );
    const unarchiveThread = useMemo(
        () => guardMutation((threadId: string) => store.unarchiveThread(threadId)),
        [guardMutation, store],
    );
    const deleteThread = useMemo(
        () => guardMutation((threadId: string) => store.deleteThread(threadId)),
        [guardMutation, store],
    );
    const fetchMoreThreads = useCallback((): void => store.fetchNextPage(), [store]);
    const refetchThreads = useCallback((): void => store.refetchThreads(), [store]);
    const startNewThread = useCallback((): void => {
        setConfigErrorDismissed(true);
        store.startNewThread();
    }, [store]);

    return {
        threads,
        isLoading,
        error,
        listError: storeError,
        fetchMoreError,
        hasMoreThreads,
        isFetchingMoreThreads,
        isMutating,
        fetchMoreThreads,
        refetchThreads,
        startNewThread,
        renameThread,
        archiveThread,
        unarchiveThread,
        deleteThread,
    };
}
