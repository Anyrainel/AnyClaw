/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock pb client — vi.hoisted ensures the variables exist at hoist-time
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

// Import AFTER mock is registered
import { usePreferences } from "../src/hooks/usePreferences.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockCollection.mockReturnValue({
    getList: mockGetList,
    subscribe: mockSubscribe,
  });
  // Default: getList resolves to empty, subscribe resolves to a noop unsub
  mockGetList.mockResolvedValue({ items: [] });
  mockSubscribe.mockResolvedValue(vi.fn());
});

afterEach(() => {
  cleanup();
});

describe("usePreferences", () => {
  it("returns defaults before fetch resolves", () => {
    // getList never resolves — stays pending
    mockGetList.mockReturnValue(new Promise(() => {}));
    mockSubscribe.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePreferences());

    expect(result.current).toEqual({
      theme: "system",
      fontSize: "medium",
      fontFamily: "sans",
      accent: "blue",
      language: navigator.language,
    });
  });

  it("returns server values after fetch", async () => {
    mockGetList.mockResolvedValue({
      items: [
        {
          theme: "dark",
          fontSize: "large",
          fontFamily: "serif",
          accent: "rose",
          language: "fr-FR",
        },
      ],
    });

    const { result } = renderHook(() => usePreferences());

    await waitFor(() => {
      expect(result.current.theme).toBe("dark");
    });

    expect(result.current).toEqual({
      theme: "dark",
      fontSize: "large",
      fontFamily: "serif",
      accent: "rose",
      language: "fr-FR",
    });
  });

  it("updates when the real-time subscription fires a change event", async () => {
    mockGetList.mockResolvedValue({ items: [] });

    let subscribeCb: (e: { action: string; record: Record<string, unknown> }) => void = () => {};
    mockSubscribe.mockImplementation((_topic: string, cb: typeof subscribeCb) => {
      subscribeCb = cb;
      return Promise.resolve(vi.fn());
    });

    const { result } = renderHook(() => usePreferences());

    // Wait for initial fetch to settle
    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalled();
    });

    // Fire a subscription event
    act(() => {
      subscribeCb({
        action: "update",
        record: {
          theme: "light",
          fontSize: "small",
          fontFamily: "sans",
          accent: "teal",
          language: "de-DE",
        },
      });
    });

    expect(result.current).toEqual({
      theme: "light",
      fontSize: "small",
      fontFamily: "sans",
      accent: "teal",
      language: "de-DE",
    });
  });

  it("unsubscribes on unmount", async () => {
    const unsubFn = vi.fn();
    mockSubscribe.mockResolvedValue(unsubFn);

    const { unmount } = renderHook(() => usePreferences());

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalled();
    });

    unmount();

    expect(unsubFn).toHaveBeenCalled();
  });

  it("on fetch error retains defaults and logs (not throws)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGetList.mockRejectedValue(new Error("PocketBase unreachable"));

    const { result } = renderHook(() => usePreferences());

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[usePreferences]"),
        expect.any(Error),
      );
    });

    // Should still have defaults
    expect(result.current.theme).toBe("system");
    expect(result.current.fontSize).toBe("medium");

    warnSpy.mockRestore();
  });
});
