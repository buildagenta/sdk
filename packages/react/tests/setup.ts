// SPDX-FileCopyrightText: 2026-present Agenta <hello@buildagenta.com>
//
// SPDX-License-Identifier: Apache-2.0

// Bun shares one process across test files, so the DOM is registered once here
// rather than by each file that needs it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// React refuses to run act() outside an environment that declares itself one, which
// it cannot detect for itself under Bun's runner.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
