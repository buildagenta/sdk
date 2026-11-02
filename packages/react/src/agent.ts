// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import {
    type AgentStateMutation,
    type AgentSubscriber,
    type BaseEvent,
    EventType,
    HttpAgent,
    type HttpAgentConfig,
    type Message,
    type RunAgentInput,
    type RunStartedEvent,
    runHttpRequest,
    transformHttpEventStream,
} from "@ag-ui/client";
import { type Observable, filter, finalize, tap } from "rxjs";

const MAX_CACHED_THREADS = 10;

interface ActiveRun {
    threadId: string;
    runId: string;
}

interface ActiveStream {
    threadId: string;
    runId?: string;
}

/**
 * Ambient facts about the user's current situation, sent with every run.
 *
 * Empty values are dropped, so a caller can pass whatever its current page holds
 * without filtering first.
 */
export type AgentaRunContext = Record<string, string | number | boolean | null | undefined>;

/** Configuration for an Agenta AG-UI endpoint. */
export interface AgentaAgentConfig extends HttpAgentConfig {
    getContext?: () => AgentaRunContext;
}

function trailingUserTurn(input: RunAgentInput): RunAgentInput {
    const message = input.messages.findLast(({ role }) => role === "user");
    return { ...input, messages: message ? [message] : [] };
}

function withContext(input: RunAgentInput, context: AgentaRunContext | undefined): RunAgentInput {
    const entries = Object.entries(context ?? {})
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([description, value]) => ({ description, value: String(value) }));
    return entries.length > 0 ? { ...input, context: [...input.context, ...entries] } : input;
}

function hasIdentity(event: BaseEvent): event is BaseEvent & { threadId: string; runId: string } {
    const candidate = event as BaseEvent & { threadId?: unknown; runId?: unknown };
    return typeof candidate.threadId === "string" && typeof candidate.runId === "string";
}

/**
 * Direct AG-UI client for Agenta's durable run endpoints.
 *
 * The agent retains the complete local transcript while sending only the latest
 * user turn to the runtime, whose durable thread owns the prior history.
 */
export class AgentaAgent extends HttpAgent {
    private activeRun?: ActiveRun;
    private activeStream?: ActiveStream;
    private readonly cachedMessages = new Map<string, Message[]>();
    private readonly pendingRestores = new Map<string, Message[]>();
    private readonly messageRuns = new Map<string, ActiveRun>();
    private readonly getContext?: () => AgentaRunContext;

    /** Create an agent that reads the caller's current context on every run. */
    constructor({ getContext, ...config }: AgentaAgentConfig) {
        super(config);
        this.getContext = getContext;
    }

    /**
     * The thread and run that streamed a message, as the runtime recorded them.
     *
     * CopilotKit's `getRunIdForMessage` tags a replayed message with a run id of its own,
     * so this reads the runtime's from the event stream instead.
     */
    runForMessage(messageId: string): { threadId: string; runId: string } | undefined {
        return this.messageRuns.get(messageId);
    }

    /** Retain completed and streaming messages for fast in-session thread restoration. */
    override setMessages(messages: Message[]): void {
        super.setMessages(messages);
        if (!this.threadId || messages.length === 0) return;
        this.cacheMessages(this.threadId, this.messages);
    }

    /** Run the latest user turn, with the caller's context, retaining the transcript. */
    override run(input: RunAgentInput): ReturnType<HttpAgent["run"]> {
        const stream: ActiveStream = { threadId: input.threadId, runId: input.runId };
        const activeRun = { threadId: input.threadId, runId: input.runId };
        this.threadId = input.threadId;
        this.activeStream = stream;
        this.activeRun = activeRun;

        return super.run(trailingUserTurn(withContext(input, this.getContext?.()))).pipe(
            filter((event) => this.acceptsEvent(stream, event)),
            tap((event) => this.trackRunEvent(event)),
            finalize(() => {
                if (this.activeStream === stream) this.activeStream = undefined;
                if (this.activeRun === activeRun) this.activeRun = undefined;
            }),
        );
    }

    /** Cancel the active producer through Agenta's durable cancel endpoint. */
    async cancelRun(): Promise<void> {
        const activeRun = this.activeRun;
        if (!activeRun) return;

        const response = await this.fetch(`${this.url}/cancel`, {
            method: "POST",
            headers: {
                ...this.headers,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(activeRun),
            keepalive: true,
        });
        if (response.ok) return;
        if (response.status === 404) {
            try {
                const body = (await response.json()) as { detail?: unknown };
                if (body.detail === "Thread not found") return;
            } catch {
                // A router 404 without the endpoint's marker remains a failed stop.
            }
        }
        throw new Error(`Stop request failed with ${response.status}`);
    }

    /** Start durable cancellation before disconnecting the local stream. */
    override abortRun(): void {
        void this.cancelRun().catch((error: unknown) => {
            console.error("Failed to cancel the Agenta run:", error);
        });
        this.activeRun = undefined;
        this.activeStream = undefined;
        super.abortRun();
    }

    /** Show cached messages while AG-UI prepares an empty durable replay baseline. */
    override connectAgent(
        ...args: Parameters<HttpAgent["connectAgent"]>
    ): ReturnType<HttpAgent["connectAgent"]> {
        const threadId = this.threadId;
        const cached = this.cachedThreadMessages();
        this.resetForReplay();
        if (cached && threadId) {
            this.pendingRestores.set(threadId, cached);
            super.setMessages(cached);
        }
        return super.connectAgent(...args).finally(() => {
            if (threadId) this.pendingRestores.delete(threadId);
        });
    }

    /** Seed replay from an empty transcript while the cached transcript remains visible. */
    protected override apply(
        input: RunAgentInput,
        events: Observable<BaseEvent>,
        subscribers: AgentSubscriber[],
    ): Observable<AgentStateMutation> {
        const cached = this.pendingRestores.get(input.threadId);
        this.pendingRestores.delete(input.threadId);
        if (!cached || this.threadId !== input.threadId) {
            return super.apply(input, events, subscribers);
        }

        super.setMessages([]);
        const replay = super.apply(input, events, subscribers);
        super.setMessages(cached);
        return replay;
    }

    /** Keep the cache current as AG-UI applies both replayed and live message events. */
    protected override processApplyEvents(
        input: RunAgentInput,
        events: Observable<AgentStateMutation>,
        subscribers: AgentSubscriber[],
    ): Observable<AgentStateMutation> {
        return super.processApplyEvents(input, events, subscribers).pipe(
            tap((mutation) => {
                if (mutation.messages && this.threadId === input.threadId) {
                    this.cacheMessages(input.threadId, mutation.messages);
                }
            }),
        );
    }

    /** Reconnect to a durable thread and replay its event history. */
    protected override connect(input: RunAgentInput): ReturnType<HttpAgent["run"]> {
        const stream: ActiveStream = { threadId: input.threadId };
        let replayStarted = false;
        this.threadId = input.threadId;
        this.activeStream = stream;
        this.abortController = new globalThis.AbortController();

        return transformHttpEventStream(
            runHttpRequest(() =>
                this.fetch(`${this.url}/connect`, this.requestInit({ ...input, messages: [] })),
            ),
            this.debugLogger,
        ).pipe(
            filter((event) => this.acceptsEvent(stream, event)),
            tap((event) => {
                if (!replayStarted) {
                    replayStarted = true;
                    this.resetForReplay();
                }
                this.trackRunEvent(event);
            }),
            finalize(() => {
                if (this.activeStream !== stream) return;
                this.cacheMessages(stream.threadId, this.messages, true);
                this.activeStream = undefined;
                if (this.activeRun?.threadId === stream.threadId) this.activeRun = undefined;
            }),
        );
    }

    private cacheMessages(threadId: string, messages: Message[], replace = false): void {
        if (messages.length === 0) {
            if (replace) this.cachedMessages.delete(threadId);
            return;
        }
        const cached = this.cachedMessages.get(threadId);
        const replaying = this.activeStream?.threadId === threadId && !this.activeStream.runId;
        if (replaying && !replace && cached && !this.hasReachedCachedMessages(messages, cached)) {
            return;
        }
        this.cachedMessages.delete(threadId);
        this.cachedMessages.set(threadId, [...messages]);
        while (this.cachedMessages.size > MAX_CACHED_THREADS) {
            const oldest = this.cachedMessages.keys().next().value;
            if (oldest === undefined) break;
            this.cachedMessages.delete(oldest);
        }
    }

    private hasReachedCachedMessages(messages: Message[], cached: Message[]): boolean {
        if (messages.length < cached.length) return false;
        return cached.every((cachedMessage, index) => {
            const message = messages[index];
            if (!message || message.id !== cachedMessage.id) return false;
            if (typeof message.content !== "string" || typeof cachedMessage.content !== "string") {
                return true;
            }
            return message.content.startsWith(cachedMessage.content);
        });
    }

    private cachedThreadMessages(): Message[] | undefined {
        const threadId = this.threadId;
        if (!threadId) return undefined;
        const messages = this.cachedMessages.get(threadId);
        if (!messages) return undefined;
        this.cachedMessages.delete(threadId);
        this.cachedMessages.set(threadId, messages);
        return [...messages];
    }

    private resetForReplay(): void {
        super.setMessages([]);
        this.setState({});
        this.pendingInterrupts = [];
    }

    private acceptsEvent(stream: ActiveStream, event: BaseEvent): boolean {
        if (this.activeStream !== stream || this.threadId !== stream.threadId) return false;
        if (!hasIdentity(event)) return true;
        if (event.threadId !== stream.threadId) return false;
        return stream.runId === undefined || event.runId === stream.runId;
    }

    private trackRunEvent(event: BaseEvent): void {
        if (event.type === EventType.RUN_STARTED) {
            const { threadId, runId } = event as RunStartedEvent;
            this.activeRun = { threadId, runId };
            return;
        }
        const { messageId } = event as BaseEvent & { messageId?: unknown };
        if (typeof messageId === "string" && this.activeRun) {
            this.messageRuns.set(messageId, this.activeRun);
        }
        if (
            (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR) &&
            hasIdentity(event) &&
            this.activeRun?.threadId === event.threadId &&
            this.activeRun.runId === event.runId
        ) {
            this.activeRun = undefined;
        }
    }
}
