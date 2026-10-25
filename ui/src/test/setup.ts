import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount what each test rendered (testing-library does this itself only with globals on).
afterEach(() => cleanup());
