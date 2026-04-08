import { z } from "zod";
import type PocketBase from "pocketbase";
import { withErrorHandling } from "./register.js";
import { getPocketBaseAdmin } from "../pocketbase-client.js";

export const updateProgressInput = z.object({
  message: z.string().min(1),
  phase: z.enum(["clarifying", "working", "deploying"]).default("working"),
  percent: z.number().min(0).max(100).optional(),
});
export const updateProgressOutput = z.object({ delivered: z.boolean() });

export type Ctx = { taskId: string };

export function makeUpdateProgressHandler(pbFactory: () => PocketBase = getPocketBaseAdmin) {
  return withErrorHandling(async (
    input: z.infer<typeof updateProgressInput>,
    ctx: Ctx,
  ) => {
    await pbFactory().collection("_agent_messages").create({
      taskId: ctx.taskId,
      direction: "agent_to_user",
      type: "progress",
      content: input.message,
      phase: input.phase,
      percent: input.percent,
    });
    return {
      content: [{ type: "text" as const, text: `Progress: ${input.message}` }],
      structuredContent: { delivered: true },
    };
  });
}

export function registerUpdateProgress(server: any, ctx: Ctx) {
  server.registerTool(
    "anyclaw_update_progress",
    {
      title: "Update Progress",
      description:
        "Post a progress update to the mobile app's task card. Non-blocking. Use frequently during long operations.",
      inputSchema: updateProgressInput,
      outputSchema: updateProgressOutput,
    },
    (input: any) => makeUpdateProgressHandler()(input, ctx),
  );
}
