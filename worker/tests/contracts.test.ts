import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import type { TranscriptResult } from "../src/contracts/transcript-result";

function readSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(`../../contracts/${file}`, import.meta.url), "utf8")) as object;
}

function validator(file: string): ValidateFunction {
  const ajv = new Ajv2020({ strict: true });
  ajv.addSchema(readSchema("transcript-result.schema.json"), "transcript-result.schema.json");
  return ajv.compile(readSchema(file));
}

const validResult: TranscriptResult = {
  video_id: "dQw4w9WgXcQ",
  status: "ok",
  lang: "en",
  source: "manual",
  word_count: 3,
  truncated: false,
  sponsor_ratio: 0.25,
  pages: ["one two three"],
};

describe("transcript result schema", () => {
  const validate = validator("transcript-result.schema.json");

  test("accepts a valid result", () => {
    expect(validate(validResult)).toBe(true);
  });

  test.each([
    ["an extra field", { extra: 1 }],
    ["a bad video_id", { video_id: "short" }],
    ["a bad status", { status: "done" }],
    ["a bad source", { source: "other" }],
    ["a negative word_count", { word_count: -1 }],
  ])("rejects %s", (_name, change) => {
    expect(validate({ ...validResult, ...change })).toBe(false);
  });
});

describe("log event schema", () => {
  const validate = validator("log-event.schema.json");
  const line = { ts: "2026-10-16T12:00:00.000Z", level: "info", service: "worker", event: "service.started", attrs: {} };

  test("accepts a valid log line", () => {
    expect(validate(line)).toBe(true);
  });

  test.each([
    ["an unknown event", { event: "unknown.event" }],
    ["an extra field", { extra: 1 }],
    ["a bad timestamp", { ts: "yesterday" }],
  ])("rejects %s", (_name, change) => {
    expect(validate({ ...line, ...change })).toBe(false);
  });
});

const ts = "2026-10-16T07:00:01.123Z";
const lease = "0123456789abcdef";
const claimed = { video_id: "dQw4w9WgXcQ", lease_id: lease, lease_expires_at: ts };
const heartbeat = { version: "0.1.0", uptime_s: 5, jobs_in_progress: 0, last_success_at: ts, last_blocked_at: null, disk_free_ratio: 0.5, cpu_temp_c: 48.5 };
const resultRequest = { lease_id: "l", outcome: "ok", transcript: validResult };
const heartbeatWithoutVersion: Record<string, unknown> = { ...heartbeat };
delete heartbeatWithoutVersion.version;

const cases: [string, unknown, [string, unknown][]][] = [
  [
    "node-heartbeat-request",
    heartbeat,
    [
      ["an extra field", { ...heartbeat, extra: 1 }],
      ["no version", heartbeatWithoutVersion],
      ["an empty version", { ...heartbeat, version: "" }],
      ["a bad timestamp", { ...heartbeat, last_success_at: "yesterday" }],
    ],
  ],
  [
    "node-heartbeat-response",
    { node_id: "n1", state: "healthy", hourly_budget: 10, directive: "run" },
    [["a bad state", { node_id: "n1", state: "x", hourly_budget: 10, directive: "run" }]],
  ],
  [
    "node-claim-request",
    { max_jobs: 3 },
    [
      ["an extra field", { extra: 1 }],
      ["a max_jobs of 0", { max_jobs: 0 }],
      ["a max_jobs of 11", { max_jobs: 11 }],
    ],
  ],
  [
    "node-claim-response",
    { jobs: [claimed] },
    [
      ["a short lease_id", { jobs: [{ ...claimed, lease_id: "short" }] }],
      ["an extra job field", { jobs: [{ ...claimed, extra: 1 }] }],
    ],
  ],
  [
    "node-result-request",
    resultRequest,
    [
      ["an extra field", { ...resultRequest, extra: 1 }],
      ["an unknown outcome", { ...resultRequest, outcome: "done" }],
      ["a transcript that breaks the transcript schema", { ...resultRequest, transcript: { ...validResult, extra: 1 } }],
      ["a missing transcript key", { lease_id: "l", outcome: "ok" }],
    ],
  ],
  ["node-release-request", { lease_id: "l" }, [["an empty lease_id", { lease_id: "" }]]],
  [
    "node-job-ack",
    { video_id: "dQw4w9WgXcQ", status: "done" },
    [["a bad status", { video_id: "dQw4w9WgXcQ", status: "other" }]],
  ],
  [
    "error",
    { error: { code: "c", message: "m" } },
    [
      ["an extra field", { error: { code: "c", message: "m", extra: 1 } }],
      ["no message", { error: { code: "c" } }],
    ],
  ],
];

describe.each(cases)("%s schema", (name, valid, invalid) => {
  const validate = validator(`${name}.schema.json`);

  test("accepts a valid instance", () => {
    expect(validate(valid)).toBe(true);
  });

  test.each(invalid)("rejects %s", (_what, instance) => {
    expect(validate(instance)).toBe(false);
  });
});

test("node-result-request accepts a null transcript", () => {
  expect(validator("node-result-request.schema.json")({ lease_id: "l", outcome: "error", transcript: null })).toBe(true);
});

test("the generated result request type reuses the generated transcript result type", () => {
  const source = readFileSync(new URL("../src/contracts/node-result-request.ts", import.meta.url), "utf8");
  expect(source).toContain('import type { TranscriptResult } from "./transcript-result";');
  expect(source).not.toContain("interface TranscriptResult");
  expect(source).not.toContain("word_count");
});

test("the log schema lists the lot 2 events", () => {
  const validate = validator("log-event.schema.json");
  const line = { ts, level: "info", service: "worker", attrs: {} };
  expect(validate({ ...line, event: "job.claimed" })).toBe(true);
  expect(validate({ ...line, event: "job.unknown" })).toBe(false);
});
