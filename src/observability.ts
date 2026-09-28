type LogLevel = "info" | "warn" | "error";
type Scalar = string | number | boolean | null;

export function logOperationalEvent(level: LogLevel, event: string, details: Record<string, Scalar> = {}): void {
  const safeDetails = Object.fromEntries(Object.entries(details).flatMap(([key, value]) => {
    if (!/^[a-z][a-zA-Z0-9]{0,39}$/.test(key)) return [];
    if (typeof value === "string" && value.length > 120) return [[key, value.slice(0, 120)]];
    return [[key, value]];
  }));
  console[level](JSON.stringify({ kind: "mvp_backend", event, ...safeDetails }));
}
