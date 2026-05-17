/**
 * Simple async FIFO queue that implements AsyncIterable.
 * push() enqueues items; close() signals no more items.
 * for-await-of drains items one at a time.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  public lastSeq = 0;

  private buffer: T[] = [];
  private closed = false;
  private resolve: (() => void) | null = null;

  push(item: T): void {
    this.lastSeq++;
    this.buffer.push(item);
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r();
    }
  }

  close(): void {
    this.closed = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r();
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      while (this.buffer.length > 0) {
        yield this.buffer.shift()!;
      }
      if (this.closed) return;
      await new Promise<void>((r) => {
        this.resolve = r;
      });
    }
  }
}
