export interface ResourceLimitConfig {
  cpuQuotaPercent: number;
  memoryMaxMb: number;
}

export interface ResourceLimits {
  /** Prepare cgroup/limit handle for a task. Returns an opaque handle or null. */
  prepare(taskId: string, config: ResourceLimitConfig): Promise<string | null>;
  /** Apply the prepared limits to a running process. */
  apply(pid: number, handle: string): Promise<void>;
  /** Release limits associated with the handle. */
  release(handle: string): Promise<void>;
}
