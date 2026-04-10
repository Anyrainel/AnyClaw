export interface LogEntry {
  timestamp: number;
  direction: "request" | "response";
  method: string;
  path: string;
  body: unknown;
}

const MAX_ENTRIES = 500;

export class LogBuffer {
  private _entries: LogEntry[] = [];

  push(entry: LogEntry): void {
    this._entries.push(entry);
    if (this._entries.length > MAX_ENTRIES) {
      this._entries.shift();
    }
  }

  entries(): readonly LogEntry[] {
    return this._entries;
  }

  clear(): void {
    this._entries = [];
  }
}
