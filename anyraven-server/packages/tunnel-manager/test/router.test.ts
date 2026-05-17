import { describe, it, expect } from "vitest";
import { ServiceRouter, type ServiceTag } from "../src/router.js";

describe("ServiceRouter", () => {
  const router = new ServiceRouter({
    pb: 8090,
    api: 4100,
    app: 5173,
  });

  it("maps pb -> 8090", () => {
    expect(router.portFor("pb")).toBe(8090);
  });
  it("maps api -> 4100", () => {
    expect(router.portFor("api")).toBe(4100);
  });
  it("maps app -> 5173", () => {
    expect(router.portFor("app")).toBe(5173);
  });
  it("throws for unknown service tags", () => {
    expect(() => router.portFor("nope" as ServiceTag)).toThrow(/unknown/i);
  });
  it("returns the local URL for a service", () => {
    expect(router.urlFor("pb")).toBe("http://127.0.0.1:8090");
    expect(router.urlFor("api")).toBe("http://127.0.0.1:4100");
    expect(router.urlFor("app")).toBe("http://127.0.0.1:5173");
  });
});
