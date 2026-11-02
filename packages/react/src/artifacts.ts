// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import type { AbstractAgent } from "@ag-ui/client";
import { useEffect, useState } from "react";

/** The AG-UI custom event emitted when an Agenta agent produces an artifact. */
export const AG_UI_ARTIFACT_EVENT_NAME = "a2anet.adk.artifact";

/** A downloadable file parsed from an Agenta artifact event. */
export interface ReceivedArtifactFile {
    id: string;
    filename: string;
    mimeType: string;
    /** Base64 bytes as serialized by ADK. Absent for URI-delivered files. */
    bytes?: string;
    uri?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: Record<string, unknown>, key: string): string {
    return typeof record[key] === "string" ? (record[key] as string) : "";
}

function getRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
    return isRecord(record[key]) ? (record[key] as Record<string, unknown>) : {};
}

/**
 * Parse the value of an `a2anet.adk.artifact` custom event.
 *
 * Text artifacts are omitted because their content is already represented in the transcript.
 */
export function readArtifactEvent(value: unknown): ReceivedArtifactFile | null {
    if (!isRecord(value)) return null;

    const filename = getString(value, "filename");
    const part = getRecord(value, "artifact");
    if (!filename || Object.keys(part).length === 0) return null;

    const versionMimeType = getString(getRecord(value, "versionInfo"), "mimeType");
    const id = `${filename}_${String(value.version ?? 0)}`;
    const inlineData = getRecord(part, "inlineData");
    if (Object.keys(inlineData).length > 0) {
        return {
            id,
            filename,
            mimeType: getString(inlineData, "mimeType") || versionMimeType,
            bytes: getString(inlineData, "data"),
        };
    }

    const fileData = getRecord(part, "fileData");
    if (Object.keys(fileData).length > 0) {
        return {
            id,
            filename,
            mimeType: getString(fileData, "mimeType") || versionMimeType,
            uri: getString(fileData, "fileUri"),
        };
    }

    return null;
}

/**
 * Object URL for an artifact delivered as base64.
 *
 * ADK serialises bytes as URL-safe base64 ("-"/"_" for "+"/"/"), which `atob`
 * rejects outright, so any artifact whose bytes happen to encode one of those
 * characters fails without translating the alphabet first. Padding is preserved.
 */
export function artifactObjectUrl(bytes: string, mimeType: string): string {
    const binary = atob(bytes.replace(/-/g, "+").replace(/_/g, "/"));
    const octets = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return URL.createObjectURL(new Blob([octets], { type: mimeType }));
}

/**
 * Save an agent-produced file through the browser's own download flow.
 *
 * The anchor must be in the document and the object URL must outlive the click:
 * a detached anchor, or revoking during the same task, cancels the download
 * before it starts, which reads as the button doing nothing at all.
 */
export function downloadArtifact(file: ReceivedArtifactFile): void {
    const objectUrl = file.uri
        ? undefined
        : file.bytes && artifactObjectUrl(file.bytes, file.mimeType);
    const href = file.uri || objectUrl;
    if (!href) return;

    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = file.filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/**
 * Collect the files an agent produces, keyed by the message each one followed.
 *
 * Artifact events are interleaved with message events in a durable replay, so a
 * file is attached to the latest assistant message and deduplicated by id when
 * the same thread is replayed after its live run.
 */
export function useAgentaArtifacts(
    agent: AbstractAgent,
    threadId: string,
): ReadonlyMap<string, ReceivedArtifactFile[]> {
    const [artifacts, setArtifacts] = useState(new Map<string, ReceivedArtifactFile[]>());
    const [collectedFor, setCollectedFor] = useState(threadId);

    // Files belong to the thread that produced them, so a thread change drops them
    // during the render that observes it rather than after a frame showing the old set.
    if (collectedFor !== threadId) {
        setCollectedFor(threadId);
        setArtifacts(new Map());
    }

    useEffect(() => {
        return agent.subscribe({
            onCustomEvent: ({ event, messages }) => {
                if (event.name !== AG_UI_ARTIFACT_EVENT_NAME) return;
                const file = readArtifactEvent(event.value);
                const messageId = messages.findLast(({ role }) => role === "assistant")?.id;
                if (!file || !messageId) return;

                setArtifacts((previous) => {
                    const received = previous.get(messageId) ?? [];
                    if (received.some((artifact) => artifact.id === file.id)) return previous;
                    return new Map(previous).set(messageId, [...received, file]);
                });
            },
        }).unsubscribe;
    }, [agent]);

    return artifacts;
}
