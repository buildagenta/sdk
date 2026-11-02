// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

/**
 * One view of the conversation: CopilotChat, plus what Agenta adds to it.
 *
 * The agent's files arrive as events rather than messages, so they are rendered under
 * the reply they followed. Its thumbs record feedback for the agent's owner, and a
 * thumb opens a box for saying why.
 */

import {
    type AgentaFeedback,
    downloadArtifact,
    useAgentaArtifacts,
    useAgentaFeedback,
} from "@buildagenta/react";
import {
    CopilotChat,
    CopilotChatAssistantMessage,
    type CopilotChatAssistantMessageProps,
    useAgent,
} from "@copilotkit/react-core/v2";
import { type ReactElement, useMemo, useState } from "react";

interface Rated {
    messageId: string;
    value: AgentaFeedback["value"];
}

function FeedbackForm({
    onSend,
    onClose,
}: {
    onSend: (rationale: string) => void;
    onClose: () => void;
}): ReactElement {
    const [rationale, setRationale] = useState("");

    return (
        <form
            className="feedback"
            onSubmit={(event) => {
                event.preventDefault();
                onSend(rationale);
            }}
        >
            <textarea
                value={rationale}
                onChange={(event) => setRationale(event.target.value)}
                placeholder="Tell us more (optional)"
                rows={2}
            />
            <div className="actions">
                <button type="button" onClick={onClose}>
                    Skip
                </button>
                <button type="submit" disabled={!rationale.trim()}>
                    Send
                </button>
            </div>
        </form>
    );
}

export function Chat({ agentId, threadId }: { agentId: string; threadId: string }): ReactElement {
    const { agent } = useAgent({ agentId, updates: [] });
    const artifacts = useAgentaArtifacts(agent, threadId);
    const rate = useAgentaFeedback();
    const [rated, setRated] = useState<Rated | null>(null);

    // Object.assign carries over the slot's static members, which its type requires.
    const assistantMessage = useMemo(() => {
        const send = (messageId: string, feedback: AgentaFeedback): void => {
            rate(messageId, feedback).catch((error: unknown) => {
                console.error("[assistant]", error);
            });
        };
        const thumb = (messageId: string, value: AgentaFeedback["value"]): void => {
            // The thumb counts on its own; the text, if any, replaces it with more.
            send(messageId, { value });
            setRated({ messageId, value });
        };

        return Object.assign(
            (props: CopilotChatAssistantMessageProps) => (
                <>
                    <CopilotChatAssistantMessage
                        {...props}
                        onThumbsUp={(message) => thumb(message.id, 1)}
                        onThumbsDown={(message) => thumb(message.id, 0)}
                    />
                    {(artifacts.get(props.message.id) ?? []).map((file) => (
                        <button
                            key={file.id}
                            type="button"
                            className="file"
                            onClick={() => downloadArtifact(file)}
                        >
                            {file.filename}
                        </button>
                    ))}
                    {rated?.messageId === props.message.id && (
                        <FeedbackForm
                            onSend={(rationale) => {
                                send(rated.messageId, { value: rated.value, rationale });
                                setRated(null);
                            }}
                            onClose={() => setRated(null)}
                        />
                    )}
                </>
            ),
            CopilotChatAssistantMessage,
        );
    }, [artifacts, rate, rated]);

    return (
        <CopilotChat
            agentId={agentId}
            threadId={threadId}
            messageView={{ assistantMessage }}
            // Read as base64 and sent with the message, for the agent to open.
            attachments={{ enabled: true }}
        />
    );
}
