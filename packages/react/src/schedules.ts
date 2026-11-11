// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from "react";

import { useAgenta } from "./provider.js";

/** Where a scheduled chat's reply is sent, besides its own thread. */
export type AgentaScheduleDelivery =
    | { platform: "email"; cc?: string[] }
    | { platform: "slack"; channel?: { id: string; name: string } };

/** A message Agenta sends the agent on the user's behalf, on a cron schedule. */
export interface AgentaSchedule {
    id: string;
    message: string;
    cron: string;
    timeZone: string;
    enabled: boolean;
    sendResponseTo: AgentaScheduleDelivery | null;
    nextRunAt: string | null;
    lastRunAt: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
}

/** What creating a schedule sets. The time zone defaults to the user's profile, then UTC. */
export interface AgentaScheduleInput {
    message: string;
    cron: string;
    timeZone?: string;
    enabled?: boolean;
    /**
     * Email goes to the user's own address, copying in `cc` at their own company. A Slack
     * channel is named by id or name; leaving it out sends a direct message.
     */
    sendResponseTo?:
        | { platform: "email"; cc?: string[] }
        | { platform: "slack"; channel?: { id?: string; name?: string } }
        | null;
}

/** Schedule state and operations returned by {@link useAgentaSchedules}. */
export interface UseAgentaSchedulesResult {
    schedules: AgentaSchedule[];
    isLoading: boolean;
    error: Error | null;
    refetchSchedules: () => Promise<void>;
    createSchedule: (input: AgentaScheduleInput) => Promise<AgentaSchedule>;
    /** Also pauses or resumes one, through `enabled`. */
    updateSchedule: (id: string, changes: Partial<AgentaScheduleInput>) => Promise<AgentaSchedule>;
    deleteSchedule: (id: string) => Promise<void>;
}

/**
 * List and manage the user's scheduled chats with the agent.
 *
 * The customer token names the user and the agent, so Agenta confines every request to
 * their own schedules. A run a schedule starts appears in `useAgentaThreads` with the type
 * `"scheduled"`.
 */
export function useAgentaSchedules(): UseAgentaSchedulesResult {
    const { apiUrl, authenticatedFetch } = useAgenta();
    const [schedules, setSchedules] = useState<AgentaSchedule[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const request = useCallback(
        async <T>(path: string, method: string, body?: unknown): Promise<T> => {
            const response = await authenticatedFetch(`${apiUrl}/customer-schedules${path}`, {
                method,
                headers: { "Content-Type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            if (!response.ok) {
                // Agenta explains a refused schedule, such as a cron it cannot honour.
                const failure = (await response.json().catch(() => null)) as {
                    error?: { message?: string };
                } | null;
                throw new Error(
                    failure?.error?.message ?? `Agenta request failed with ${response.status}`,
                );
            }
            return (response.status === 204 ? undefined : await response.json()) as T;
        },
        [apiUrl, authenticatedFetch],
    );

    const refetchSchedules = useCallback(async (): Promise<void> => {
        setIsLoading(true);
        try {
            const listed = await request<{ schedules: AgentaSchedule[] }>("", "GET");
            setSchedules(listed.schedules);
            setError(null);
        } catch (value) {
            setError(value instanceof Error ? value : new Error(String(value)));
        } finally {
            setIsLoading(false);
        }
    }, [request]);

    useEffect(() => {
        void refetchSchedules();
    }, [refetchSchedules]);

    const createSchedule = useCallback(
        async (input: AgentaScheduleInput): Promise<AgentaSchedule> => {
            const created = await request<AgentaSchedule>("", "POST", input);
            // Agenta lists the newest first.
            setSchedules((previous) => [created, ...previous]);
            return created;
        },
        [request],
    );

    const updateSchedule = useCallback(
        async (id: string, changes: Partial<AgentaScheduleInput>): Promise<AgentaSchedule> => {
            const updated = await request<AgentaSchedule>(
                `/${encodeURIComponent(id)}`,
                "PATCH",
                changes,
            );
            setSchedules((previous) =>
                previous.map((schedule) => (schedule.id === id ? updated : schedule)),
            );
            return updated;
        },
        [request],
    );

    const deleteSchedule = useCallback(
        async (id: string): Promise<void> => {
            await request<void>(`/${encodeURIComponent(id)}`, "DELETE");
            setSchedules((previous) => previous.filter((schedule) => schedule.id !== id));
        },
        [request],
    );

    return {
        schedules,
        isLoading,
        error,
        refetchSchedules,
        createSchedule,
        updateSchedule,
        deleteSchedule,
    };
}
