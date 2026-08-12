export const packageName = 'observability' as const;

export type LogFields = Record<string, unknown>;

/** Minimal structured logger (JSON lines). No secrets. */
export function createLogger(service: string) {
  return {
    info(msg: string, fields?: LogFields): void {
      console.log(JSON.stringify({ level: 'info', service, msg, ...fields }));
    },
    warn(msg: string, fields?: LogFields): void {
      console.warn(JSON.stringify({ level: 'warn', service, msg, ...fields }));
    },
    error(msg: string, fields?: LogFields): void {
      console.error(JSON.stringify({ level: 'error', service, msg, ...fields }));
    },
  };
}
