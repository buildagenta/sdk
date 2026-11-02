// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { VERSION } from "../src/index.js";

describe("@buildagenta/react", () => {
    test("has a semantic version", () => {
        expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
});
