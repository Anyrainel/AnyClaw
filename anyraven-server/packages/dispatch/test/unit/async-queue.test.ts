import { describe, it, expect } from "vitest";
import { AsyncQueue } from "../../src/util/async-queue.js";
describe("AsyncQueue", () => {
  it("yields pushed values in order then closes", async () => {
    const q = new AsyncQueue<number>();
    q.push(1); q.push(2); q.close();
    const out: number[] = [];
    for await (const v of q) out.push(v);
    expect(out).toEqual([1, 2]);
  });
  it("awaits values pushed after iteration starts", async () => {
    const q = new AsyncQueue<string>();
    const p = (async () => { const out: string[] = []; for await (const v of q) out.push(v); return out; })();
    setTimeout(() => { q.push("a"); q.push("b"); q.close(); }, 10);
    expect(await p).toEqual(["a", "b"]);
  });
});
