import { existsSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import chokidar, { type FSWatcher } from "chokidar";
import type { Server } from "node:http";
import { createFallbackApp } from "./fallback.js";

export type RunnerMode = "fallback" | "running";

export interface LogicRunnerOptions {
  buildDir: string;
  port: number;
  nodeBin?: string;
}

export class LogicRunner {
  public mode: RunnerMode = "fallback";
  private child: ChildProcess | undefined;
  private watcher: FSWatcher | undefined;
  private fallback: Server | undefined;

  constructor(private readonly opts: LogicRunnerOptions) {}

  async start(): Promise<void> {
    await this.reconcile();
    this.watcher = chokidar.watch(this.opts.buildDir, { ignoreInitial: true });
    this.watcher.on("all", () => { void this.reconcile(); });
  }

  async reloadForTest(): Promise<void> {
    await this.reconcile();
  }

  private async reconcile(): Promise<void> {
    const entry = path.join(this.opts.buildDir, "index.js");
    if (existsSync(entry)) {
      await this.stopFallback();
      await this.stopChild();
      this.child = spawn(this.opts.nodeBin ?? process.execPath, [entry], {
        stdio: "inherit",
        env: { ...process.env, PORT: String(this.opts.port) },
      });
      this.mode = "running";
    } else {
      await this.stopChild();
      if (!this.fallback) {
        const app = createFallbackApp();
        await new Promise<void>((resolve) => {
          this.fallback = app.listen(this.opts.port, () => resolve());
        });
      }
      this.mode = "fallback";
    }
  }

  private async stopChild(): Promise<void> {
    if (this.child) {
      this.child.kill();
      this.child = undefined;
    }
  }

  private async stopFallback(): Promise<void> {
    if (this.fallback) {
      await new Promise<void>((resolve) => this.fallback!.close(() => resolve()));
      this.fallback = undefined;
    }
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    await this.stopChild();
    await this.stopFallback();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const buildDir = process.env.LOGIC_BUILD_DIR ?? "/data/prod/logic-build";
  const port = Number(process.env.PORT ?? 3000);
  const runner = new LogicRunner({ buildDir, port });
  runner.start().then(() => {
    // eslint-disable-next-line no-console
    console.log(`[logic-runner] listening on :${port} mode=${runner.mode}`);
  });
}
