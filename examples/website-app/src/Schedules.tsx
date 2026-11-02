// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Messages Agenta sends the agent on the user's behalf, on a cron schedule.
 *
 * Each run is a new conversation, listed under Scheduled in the history.
 */

import { type AgentaSchedule, useAgentaSchedules } from "@buildagenta/react";
import { type FormEvent, type ReactElement, useState } from "react";

const formatRun = (value: string): string =>
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
    );

function ScheduleRow({
    schedule,
    onToggle,
    onDelete,
}: {
    schedule: AgentaSchedule;
    onToggle: () => void;
    onDelete: () => void;
}): ReactElement {
    return (
        <li className="schedule">
            <p>{schedule.message}</p>
            <small>
                <code>{schedule.cron}</code> ({schedule.timeZone})
                {schedule.enabled && schedule.nextRunAt
                    ? ` · next ${formatRun(schedule.nextRunAt)}`
                    : " · paused"}
            </small>
            {schedule.lastError && <small className="error">{schedule.lastError}</small>}
            <div className="actions">
                <button type="button" onClick={onToggle}>
                    {schedule.enabled ? "Pause" : "Resume"}
                </button>
                <button type="button" onClick={onDelete}>
                    Delete
                </button>
            </div>
        </li>
    );
}

export function Schedules(): ReactElement {
    const { schedules, isLoading, error, createSchedule, updateSchedule, deleteSchedule } =
        useAgentaSchedules();
    const [message, setMessage] = useState("");
    const [cron, setCron] = useState("0 9 * * 1-5");
    // Agenta says why it refused a change, such as a cron it cannot honour.
    const [actionError, setActionError] = useState<string | null>(null);

    const perform = async (action: () => Promise<unknown>): Promise<boolean> => {
        try {
            await action();
            setActionError(null);
            return true;
        } catch (value) {
            setActionError(value instanceof Error ? value.message : String(value));
            return false;
        }
    };

    const submit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        const created = await perform(() =>
            createSchedule({
                message,
                cron,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }),
        );
        if (created) setMessage("");
    };

    return (
        <section className="panel">
            {error && <p className="notice">{error.message}</p>}
            {isLoading && <p className="notice">Loading…</p>}
            <ul className="list">
                {schedules.map((schedule) => (
                    <ScheduleRow
                        key={schedule.id}
                        schedule={schedule}
                        onToggle={() =>
                            void perform(() =>
                                updateSchedule(schedule.id, { enabled: !schedule.enabled }),
                            )
                        }
                        onDelete={() => void perform(() => deleteSchedule(schedule.id))}
                    />
                ))}
            </ul>
            <form className="schedule-form" onSubmit={submit}>
                <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="What should the agent do?"
                    rows={2}
                    required
                />
                <label>
                    Cron <input value={cron} onChange={(event) => setCron(event.target.value)} />
                </label>
                {actionError && <small className="error">{actionError}</small>}
                <button type="submit">Schedule</button>
            </form>
        </section>
    );
}
