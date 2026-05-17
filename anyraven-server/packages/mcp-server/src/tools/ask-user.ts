import { z } from "zod";
import type PocketBase from "pocketbase";
import { withErrorHandling } from "./register.js";
import { ToolError } from "../errors.js";
import { getPocketBaseAdmin } from "../pocketbase-client.js";

export const askUserInput = z.object({
  question: z.string().min(1),
  options: z.array(z.string()).max(8).optional(),
  timeoutMs: z.number().int().min(1000).max(600000).default(300000),
});
export const askUserOutput = z.object({
  answer: z.string(),
  answeredAt: z.string(),
  timedOut: z.boolean(),
});

type Ctx = { taskId: string };

export function makeAskUserHandler(
  pbFactory: () => PocketBase = getPocketBaseAdmin,
) {
  return withErrorHandling(
    async (input: z.infer<typeof askUserInput>, ctx: Ctx) => {
      const pb = pbFactory();
      const col = pb.collection("_agent_messages");
      const q = await col.create({
        taskId: ctx.taskId,
        direction: "agent_to_user",
        type: "question",
        content: input.question,
        options: input.options ?? null,
      });

      const answer = await new Promise<{ content: string; answeredAt: string }>(
        (resolve, reject) => {
          let unsub: (() => void) | null = null;
          const timer = setTimeout(() => {
            try {
              unsub?.();
            } catch {
              /* ignore */
            }
            reject(
              new ToolError(
                "anyraven_ask_user timed out waiting for user response",
                { timedOut: true, questionId: (q as any).id },
              ),
            );
          }, input.timeoutMs);

          const cb = (e: any) => {
            const r = e?.record;
            if (
              e?.action === "create" &&
              r?.direction === "user_to_agent" &&
              r?.type === "answer" &&
              r?.questionId === (q as any).id
            ) {
              clearTimeout(timer);
              try {
                unsub?.();
              } catch {
                /* ignore */
              }
              resolve({
                content: r.content,
                answeredAt: r.answeredAt ?? new Date().toISOString(),
              });
            }
          };
          Promise.resolve(
            col.subscribe("*", cb, {
              filter: `taskId = "${ctx.taskId}"`,
            } as any),
          )
            .then((u: any) => {
              unsub = typeof u === "function" ? u : null;
            })
            .catch((err) => {
              clearTimeout(timer);
              reject(err);
            });
        },
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `User answered: ${answer.content}`,
          },
        ],
        structuredContent: {
          answer: answer.content,
          answeredAt: answer.answeredAt,
          timedOut: false,
        },
      };
    },
  );
}

export function registerAskUser(server: any, ctx: Ctx) {
  server.registerTool(
    "anyraven_ask_user",
    {
      title: "Ask User",
      description:
        "Post a clarifying question to the mobile app and wait for the user's answer.",
      inputSchema: askUserInput,
      outputSchema: askUserOutput,
    },
    (input: any) => makeAskUserHandler()(input, ctx),
  );
}
