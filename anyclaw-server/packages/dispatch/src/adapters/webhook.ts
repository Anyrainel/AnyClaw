import {
  AdapterError,
  type AgentAdapter,
  type SystemContext,
  type TaskHandle,
  type TaskStatus,
} from "./types.js";

export interface WebhookOptions {
  dispatchUrl: string;
  callbackBaseUrl: string;
}

export class WebhookAdapter implements AgentAdapter {
  readonly name = "Webhook";
  constructor(private readonly opts: WebhookOptions) {}

  async healthCheck(): Promise<{ ok: boolean; detail?: string | undefined }> {
    return { ok: true };
  }

  async dispatch(
    taskId: string,
    request: string,
    ctx: SystemContext,
    signal: AbortSignal,
  ): Promise<TaskHandle> {
    const res = await fetch(this.opts.dispatchUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        request,
        callbackUrl: `${this.opts.callbackBaseUrl}/api/webhook/callback`,
        mcpEndpointUrl: ctx.mcpEndpointUrl,
        mcpBearerToken: ctx.mcpBearerToken,
      }),
      signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new AdapterError(`auth ${res.status}`, "AUTH_FAILED", false);
    }
    if (res.status >= 500) {
      throw new AdapterError(`server ${res.status}`, "INTERNAL", true);
    }
    if (!res.ok) {
      throw new AdapterError(`bad ${res.status}`, "BAD_REQUEST", false);
    }

    const body = (await res.json()) as { externalId: string };
    return { taskId, adapterRef: body.externalId };
  }

  subscribe(taskId: string, signal: AbortSignal): AsyncIterable<TaskStatus> {
    // Webhook adapter relies on external provider pushing status updates.
    // Return an empty async iterable since updates come via REST callbacks.
    return (async function* () {
      while (!signal.aborted) {
        await new Promise(r => setTimeout(r, 1000));
        if (signal.aborted) break;
      }
    })();
  }

  async answerQuestion(
    _taskId: string,
    _clarificationId: string,
    _answer: string,
  ): Promise<void> {
    /* routed via REST callback */
  }

  async cancel(_taskId: string): Promise<void> {
    /* hook provider should respect cancellation via MCP */
  }

  async dispose(): Promise<void> {}
}
