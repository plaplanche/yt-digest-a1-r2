import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import type { TranscriptResult } from "../src/contracts/transcript-result";

function validator(file: string) {
  const schema: object = JSON.parse(readFileSync(new URL(`../../contracts/${file}`, import.meta.url), "utf8"));
  return new Ajv2020({ strict: true }).compile(schema);
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
