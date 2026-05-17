export class ToolError extends Error {
  public readonly details: Record<string, unknown> | undefined;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ToolError";
    this.details = details;
  }
}
