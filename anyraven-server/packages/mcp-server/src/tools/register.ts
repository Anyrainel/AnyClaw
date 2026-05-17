import { ToolError } from "../errors.js";

type TextContent = { type: "text"; text: string };

export type ToolResult = {
  content: Array<TextContent>;
  structuredContent?: unknown;
  isError?: boolean;
};

export function withErrorHandling<A extends unknown[]>(
  handler: (...args: A) => Promise<ToolResult>,
): (...args: A) => Promise<ToolResult> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      const message =
        err instanceof ToolError
          ? err.message
          : `Internal error: ${err instanceof Error ? err.message : String(err)}`;
      const details = err instanceof ToolError ? err.details : undefined;
      const content: TextContent[] = [{ type: "text", text: message }];
      if (details) {
        content.push({ type: "text", text: JSON.stringify(details, null, 2) });
      }
      return {
        content,
        isError: true,
      };
    }
  };
}
