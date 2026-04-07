export type ServiceTag = "pb" | "api" | "app";

export interface RouteMap {
  pb: number;
  api: number;
  app: number;
}

export class ServiceRouter {
  constructor(private readonly ports: RouteMap) {}

  portFor(tag: ServiceTag): number {
    const p = this.ports[tag];
    if (p === undefined) throw new Error(`unknown service tag: ${tag}`);
    return p;
  }

  urlFor(tag: ServiceTag): string {
    return `http://127.0.0.1:${this.portFor(tag)}`;
  }
}
