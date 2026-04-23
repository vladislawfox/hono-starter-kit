import { describe, expect, test } from "bun:test";
import { getLogger, rootLogger } from "./logger";

describe("getLogger", () => {
  test("falls back to rootLogger outside request context", () => {
    expect(getLogger()).toBe(rootLogger);
  });
});
