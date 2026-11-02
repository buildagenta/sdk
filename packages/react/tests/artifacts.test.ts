// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";

import { AG_UI_ARTIFACT_EVENT_NAME, artifactObjectUrl, readArtifactEvent } from "../src/index.js";

const event = (artifact: Record<string, unknown>, mimeType = "text/csv") => ({
    filename: "report.csv",
    version: 2,
    artifact,
    versionInfo: { mimeType },
});

describe("Agenta artifacts", () => {
    test("exports the custom event name", () => {
        expect(AG_UI_ARTIFACT_EVENT_NAME).toBe("a2anet.adk.artifact");
    });

    test("parses inline and URI-delivered files", () => {
        expect(
            readArtifactEvent(event({ inlineData: { data: "YSxi", mimeType: "text/csv" } })),
        ).toEqual({
            id: "report.csv_2",
            filename: "report.csv",
            mimeType: "text/csv",
            bytes: "YSxi",
        });
        expect(
            readArtifactEvent(event({ fileData: { fileUri: "https://files.example/report.csv" } })),
        ).toEqual({
            id: "report.csv_2",
            filename: "report.csv",
            mimeType: "text/csv",
            uri: "https://files.example/report.csv",
        });
    });

    test("rejects malformed and text-only artifacts", () => {
        expect(readArtifactEvent(undefined)).toBeNull();
        expect(readArtifactEvent({ artifact: "invalid" })).toBeNull();
        expect(readArtifactEvent(event({ text: "already in the transcript" }))).toBeNull();
    });

    test("decodes the URL-safe base64 ADK serialises bytes as", () => {
        // "+" and "/" arrive as "-" and "_", which `atob` rejects outright.
        const bytes = btoa(String.fromCharCode(0xfb, 0xff, 0xbf))
            .replace(/\+/g, "-")
            .replace(/\//g, "_");

        expect(() => atob(bytes)).toThrow();
        expect(artifactObjectUrl(bytes, "text/csv")).toStartWith("blob:");
    });
});
