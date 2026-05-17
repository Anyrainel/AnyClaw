import { afterEach, describe, expect, it, vi } from "vitest";
import { restartSupervisorProgram } from "../../src/index.js";

describe("restartSupervisorProgram", () => {
  afterEach(() => {
    delete process.env.ANYRAVEN_DISABLE_SUPERVISOR_RESTART;
    delete process.env.SUPERVISORCTL_PATH;
    vi.restoreAllMocks();
  });

  it("restarts the requested supervisor program", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    await restartSupervisorProgram("app-backend", exec);

    expect(exec).toHaveBeenCalledWith("supervisorctl", ["restart", "app-backend"]);
  });

  it("uses the configured supervisorctl path", async () => {
    process.env.SUPERVISORCTL_PATH = "/usr/bin/supervisorctl";
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    await restartSupervisorProgram("app-backend", exec);

    expect(exec).toHaveBeenCalledWith("/usr/bin/supervisorctl", ["restart", "app-backend"]);
  });

  it("can be disabled for local test harnesses", async () => {
    process.env.ANYRAVEN_DISABLE_SUPERVISOR_RESTART = "1";
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    await restartSupervisorProgram("app-backend", exec);

    expect(exec).not.toHaveBeenCalled();
  });

  it("wraps supervisor restart errors with program context", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("socket missing"));

    await expect(restartSupervisorProgram("app-backend", exec)).rejects.toThrow(
      /Failed to restart supervisor program app-backend: socket missing/,
    );
  });
});
