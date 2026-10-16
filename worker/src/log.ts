import { LOG_EVENT_NAMES, type LogEvent, type LogEventName } from "./contracts/log-event";

export type LogFields = Partial<Pick<LogEvent, "level" | "request_id" | "video_id" | "attrs">>;

const FIELD_KEYS = ["level", "request_id", "video_id", "attrs"] as const satisfies readonly (keyof LogEvent)[];
const LEVELS: readonly LogEvent["level"][] = ["debug", "info", "warn", "error"];

export function log(event: LogEventName, fields: LogFields = {}): void {
  if (!(LOG_EVENT_NAMES as readonly string[]).includes(event)) {
    throw new Error(`unknown log event: ${String(event)}`);
  }
  for (const key of Object.keys(fields)) {
    if (!(FIELD_KEYS as readonly string[]).includes(key)) {
      throw new Error(`unknown log field: ${key}`);
    }
  }
  const level = fields.level ?? "info";
  if (!LEVELS.includes(level)) {
    throw new Error(`unknown log level: ${String(level)}`);
  }
  const line: LogEvent = { ts: new Date().toISOString(), service: "worker", event, attrs: {}, ...fields, level };
  process.stderr.write(`${JSON.stringify(line)}\n`);
}
