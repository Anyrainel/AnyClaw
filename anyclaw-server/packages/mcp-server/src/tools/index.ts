import { registerDeploy } from "./deploy.js";
import { registerRollback } from "./rollback.js";
import { registerSnapshotDb } from "./snapshot-db.js";
import { registerCreateCollection } from "./create-collection.js";
import { registerListVersions } from "./list-versions.js";
import { registerAskUser } from "./ask-user.js";
import { registerUpdateProgress } from "./update-progress.js";

export function registerAllTools(server: any, ctx: { taskId: string }) {
  registerDeploy(server, ctx);
  registerRollback(server);
  registerSnapshotDb(server);
  registerCreateCollection(server);
  registerListVersions(server);
  registerAskUser(server, ctx);
  registerUpdateProgress(server, ctx);
}
