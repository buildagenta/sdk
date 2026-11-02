// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { expect, test } from "bun:test";

test("imports without browser globals", async () => {
    const process = Bun.spawn(
        [
            "bun",
            "-e",
            'if ("window" in globalThis) throw new Error("unexpected window"); await import("./src/index.ts")',
        ],
        {
            cwd: new URL("..", import.meta.url).pathname,
            stderr: "pipe",
        },
    );

    expect(await process.exited).toBe(0);
});
