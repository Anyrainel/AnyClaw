/**
 * Handwritten in-memory PocketBase fake for unit tests.
 * Supports collections.create / collections.getFullList and
 * collection(name).create / getFirstListItem / update / getFullList.
 */

interface Schema { name: string; type: string; required?: boolean; options?: Record<string, unknown> }
interface CollectionDef { name: string; type: string; schema: Schema[]; indexes?: string[] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

class FakeCollection {
  private rows: Row[] = [];
  private autoId = 0;

  create(data: Row): Row {
    const id = `rec_${++this.autoId}`;
    const row = { ...data, id, created: new Date().toISOString(), updated: new Date().toISOString() };
    this.rows.push(row);
    return row;
  }

  getFirstListItem(filter: string): Row {
    // Simple parser: taskId = "value"  or  state = "value"
    const match = /(\w+)\s*=\s*"([^"]*)"/.exec(filter);
    if (match) {
      const [, key, val] = match;
      const found = this.rows.find((r) => r[key!] === val);
      if (found) return found;
    }
    const err = new Error("not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }

  update(id: string, data: Row): Row {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx === -1) {
      const err = new Error("not found") as Error & { status: number };
      err.status = 404;
      throw err;
    }
    this.rows[idx] = { ...this.rows[idx], ...data, updated: new Date().toISOString() };
    return this.rows[idx]!;
  }

  getFullList(opts?: { filter?: string }): Row[] {
    if (!opts?.filter) return [...this.rows];
    // Support basic OR filters: state = "a" || state = "b"
    // Support basic AND filters: key = "a" && key = "b"
    if (opts.filter.includes("||")) {
      const parts = opts.filter.split("||").map((p) => p.trim());
      return this.rows.filter((r) =>
        parts.some((part) => {
          const m = /(\w+)\s*=\s*"([^"]*)"/.exec(part);
          if (!m) return false;
          return r[m[1]!] === m[2];
        }),
      );
    }
    if (opts.filter.includes("&&")) {
      const parts = opts.filter.split("&&").map((p) => p.trim());
      return this.rows.filter((r) =>
        parts.every((part) => {
          const m = /(\w+)\s*=\s*"([^"]*)"/.exec(part);
          if (!m) return false;
          return r[m[1]!] === m[2];
        }),
      );
    }
    // Single condition
    const parts = [opts.filter.trim()];
    return this.rows.filter((r) =>
      parts.some((part) => {
        const m = /(\w+)\s*=\s*"([^"]*)"/.exec(part);
        if (!m) return false;
        return r[m[1]!] === m[2];
      }),
    );
  }

  subscribe(_id: string, cb: (data: { action: string; record: Row }) => void): () => void {
    // Not used in basic tests; return unsubscribe stub
    void cb;
    return () => {};
  }
}

class FakeCollections {
  private defs: CollectionDef[] = [];

  create(spec: CollectionDef): CollectionDef {
    this.defs.push(spec);
    return spec;
  }

  getFullList(): CollectionDef[] {
    return [...this.defs];
  }
}

export interface FakePb {
  collections: FakeCollections;
  collection(name: string): FakeCollection;
}

const collectionMap = new WeakMap<FakePb, Map<string, FakeCollection>>();

export function makeFakePb(): FakePb {
  const map = new Map<string, FakeCollection>();
  const pb: FakePb = {
    collections: new FakeCollections(),
    collection(name: string): FakeCollection {
      let c = map.get(name);
      if (!c) {
        c = new FakeCollection();
        map.set(name, c);
      }
      return c;
    },
  };
  collectionMap.set(pb, map);
  return pb;
}

/** Helper: seed a _tasks row with a given state */
export function seedTask(pb: FakePb, taskId: string, state: string, extra?: Row): Row {
  return pb.collection("_tasks").create({ taskId, state, seq: 0, request: "r", adapterType: "claude-code", systemContext: "{}", worktreePath: "/w", ...extra });
}
