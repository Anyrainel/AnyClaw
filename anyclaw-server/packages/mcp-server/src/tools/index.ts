import { registerDeploy, type DeployManagerLike } from "./deploy.js";
import { registerRollback, type RollbackManagerLike } from "./rollback.js";
import { registerSnapshotDb, type SnapshotManagerLike } from "./snapshot-db.js";
import { registerCreateCollection } from "./create-collection.js";
import { registerListVersions } from "./list-versions.js";
import { registerAskUser } from "./ask-user.js";
import { registerUpdateProgress } from "./update-progress.js";

export interface RegisterAllToolsContext {
  taskId: string;
  deployManagerFactory?: () => DeployManagerLike;
  rollbackManagerFactory?: () => RollbackManagerLike;
  snapshotManagerFactory?: () => SnapshotManagerLike;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAllTools(server: any, ctx: RegisterAllToolsContext) {
  registerDeploy(server, { taskId: ctx.taskId }, ctx.deployManagerFactory);
  registerRollback(server, ctx.rollbackManagerFactory);
  registerSnapshotDb(server, ctx.snapshotManagerFactory);
  registerCreateCollection(server);
  registerListVersions(server);
  registerAskUser(server, { taskId: ctx.taskId });
  registerUpdateProgress(server, { taskId: ctx.taskId });
}
