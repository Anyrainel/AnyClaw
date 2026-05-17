import type { ResourceLimitConfig, ResourceLimits } from "./types.js";

export class NoopResourceLimits implements ResourceLimits {
  async prepare(_taskId: string, _config: ResourceLimitConfig): Promise<null> {
    return null;
  }

  async apply(_pid: number, _handle: string): Promise<void> {
    // no-op
  }

  async release(_handle: string): Promise<void> {
    // no-op
  }
}
