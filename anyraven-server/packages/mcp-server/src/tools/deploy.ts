import { createRequire } from "node:module";
import { z } from "zod";
import { withErrorHandling } from "./register.js";

const require = createRequire(import.meta.url);

export type DeployManagerLike = {
  run(args: {
    taskId: string;
    versionDescription: string;
    skipDbSnapshot: boolean;
  }): Promise<{
    version: string;
    gitCommit: string;
    gitTag: string;
    dbSnapshotId: string | null;
    validationResults: {
      lint: boolean;
      typecheck: boolean;
      build: boolean;
      smokeTests: boolean;
    };
  }>;
};

export const deployInput = z.object({
  versionDescription: z
    .string()
    .min(10)
    .describe(
      "User-facing description of what changed. Minimum 10 characters.",
    ),
  skipDbSnapshot: z.boolean().default(false),
});
export const deployOutput = z.object({
  version: z.string(),
  gitCommit: z.string(),
  gitTag: z.string(),
  dbSnapshotId: z.string().nullable(),
  validationResults: z.object({
    lint: z.boolean(),
    typecheck: z.boolean(),
    build: z.boolean(),
    smokeTests: z.boolean(),
  }),
});

const defaultMgr: () => DeployManagerLike = () =>
  (require("@anyraven/shared") as any).deployManager;

export function makeDeployHandler(
  factory: () => DeployManagerLike = defaultMgr,
) {
  return withErrorHandling(
    async (
      input: z.infer<typeof deployInput>,
      ctx: { taskId: string },
    ) => {
      const result = await factory().run({
        taskId: ctx.taskId,
        versionDescription: input.versionDescription,
        skipDbSnapshot: input.skipDbSnapshot,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Deployed ${result.version}: ${input.versionDescription}`,
          },
        ],
        structuredContent: result,
      };
    },
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDeploy(
  server: any,
  ctx: { taskId: string },
  factory: () => DeployManagerLike = defaultMgr,
) {
  const handler = makeDeployHandler(factory);
  server.registerTool(
    "anyraven_deploy",
    {
      title: "Deploy to Production",
      description:
        "Validate, snapshot, commit, merge to main, promote, restart app backend. REQUIRES a version description a non-technical user can understand.",
      inputSchema: deployInput,
      outputSchema: deployOutput,
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (input: any) => handler(input, ctx),
  );
}
