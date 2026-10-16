import { afterEach, expect, test, vi } from "vitest";
import { log } from "../src/log";
import type { LogEventName } from "../src/contracts/log-event";

afterEach(() => vi.restoreAllMocks());

function captureStderr(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

test("writes one JSON line on stderr", () => {
  const lines = captureStderr();
  log("service.started", { attrs: { version: "0.1.0" }, request_id: "r1" });
  expect(lines).toHaveLength(1);
  expect(lines[0]?.endsWith("\n")).toBe(true);
  const line: unknown = JSON.parse(lines[0] ?? "");
  expect(line).toMatchObject({ event: "service.started", service: "worker", level: "info", request_id: "r1" });
  expect(line).toMatchObject({ attrs: { version: "0.1.0" }, ts: expect.stringMatching(/Z$/) });
});

test("throws on an event outside the catalogue", () => {
  const lines = captureStderr();
  expect(() => log("not.catalogued" as LogEventName)).toThrow();
  expect(lines).toEqual([]);
});

test("throws on an unknown field", () => {
  expect(() => log("service.started", { extra: 1 } as never)).toThrow();
  expect(() => log("service.started", { ts: "x" } as never)).toThrow();
});

test("throws on a bad level", () => {
  expect(() => log("service.started", { level: "fatal" } as never)).toThrow();
});
