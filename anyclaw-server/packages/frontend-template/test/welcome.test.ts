/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { createElement } from "react";

// ---------------------------------------------------------------------------
// Mock PocketBase client (vi.hoisted so factory can reference them)
// ---------------------------------------------------------------------------
const { mockGetList, mockSubscribe, mockCollection } = vi.hoisted(() => {
  const mockGetList = vi.fn();
  const mockSubscribe = vi.fn();
  const mockCollection = vi.fn().mockReturnValue({
    getList: mockGetList,
    subscribe: mockSubscribe,
  });
  return { mockGetList, mockSubscribe, mockCollection };
});

vi.mock("../src/lib/pocketbase.js", () => ({
  default: { collection: mockCollection },
}));

import { Welcome } from "../src/pages/Welcome.js";

const SEED_TIPS = [
  { id: "1", title: "Try a feature request", body: "Tap Request and describe what you want.", icon: "Sparkles", created: "2025-01-01" },
  { id: "2", title: "Every change is versioned", body: "Rolling back is one tap.", icon: "History", created: "2025-01-02" },
  { id: "3", title: "The agent learns as you go", body: "Your preferences carry forward.", icon: "BookOpen", created: "2025-01-03" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockCollection.mockReturnValue({
    getList: mockGetList,
    subscribe: mockSubscribe,
  });
  mockGetList.mockResolvedValue({ items: [] });
  mockSubscribe.mockResolvedValue(vi.fn());
});

afterEach(() => {
  cleanup();
});

describe("Welcome", () => {
  it("renders loading state initially with text 'Loading tips...'", () => {
    // getList never resolves
    mockGetList.mockReturnValue(new Promise(() => {}));
    mockSubscribe.mockReturnValue(new Promise(() => {}));

    render(createElement(Welcome));

    expect(screen.getByText("Loading tips...")).toBeDefined();
  });

  it("renders error state with explicit message on fetch failure", async () => {
    mockGetList.mockRejectedValue(new Error("network down"));

    render(createElement(Welcome));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });

    expect(screen.getByText(/Could not load tips/)).toBeDefined();
  });

  it("renders empty state with onboarding copy when 0 tips", async () => {
    mockGetList.mockResolvedValue({ items: [] });

    render(createElement(Welcome));

    await waitFor(() => {
      expect(screen.getByText(/No tips yet/)).toBeDefined();
    });
  });

  it("renders all 3 seed tips when fetch resolves", async () => {
    mockGetList.mockResolvedValue({ items: SEED_TIPS });

    render(createElement(Welcome));

    await waitFor(() => {
      expect(screen.getByText("Try a feature request")).toBeDefined();
    });

    expect(screen.getByText("Every change is versioned")).toBeDefined();
    expect(screen.getByText("The agent learns as you go")).toBeDefined();
  });

  it("subscribes on mount, unsubscribes on unmount", async () => {
    const unsubFn = vi.fn();
    mockSubscribe.mockResolvedValue(unsubFn);
    mockGetList.mockResolvedValue({ items: [] });

    const { unmount } = render(createElement(Welcome));

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalled();
    });

    unmount();

    expect(unsubFn).toHaveBeenCalled();
  });

  it("footer prints prefs.theme and prefs.accent", async () => {
    mockGetList.mockResolvedValue({ items: [] });

    render(createElement(Welcome));

    await waitFor(() => {
      // Default preferences from usePreferences mock
      const footer = screen.getByText(/Theme:.*Accent:/);
      expect(footer).toBeDefined();
    });
  });

  it("contains no hardcoded hex colors in source", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "pages", "Welcome.tsx"),
      "utf-8",
    );
    // No hex colors
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    // No bg-(red|blue|green)- hardcoded color classes
    expect(src).not.toMatch(/bg-(red|blue|green)-/);
  });

  it("source file is under 200 lines", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "pages", "Welcome.tsx"),
      "utf-8",
    );
    const lineCount = src.split("\n").length;
    expect(lineCount).toBeLessThan(200);
  });
});
