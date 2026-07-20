/**
 * Structured JSON logging to stderr, mirroring the server's slog JSON style.
 * A signage player is headless in production; journald captures stderr when
 * running under systemd, so one line-delimited JSON stream is the whole story.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let minimumLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  minimumLevel = level;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

function emit(
  level: LogLevel,
  component: string,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) {
    return;
  }
  const record: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    component,
    msg,
    ...fields,
  };
  try {
    process.stderr.write(JSON.stringify(record) + "\n");
  } catch {
    // Logging must never take the player down.
  }
}

export function logger(component: string): Logger {
  return {
    debug: (msg, fields) => emit("debug", component, msg, fields),
    info: (msg, fields) => emit("info", component, msg, fields),
    warn: (msg, fields) => emit("warn", component, msg, fields),
    error: (msg, fields) => emit("error", component, msg, fields),
  };
}
