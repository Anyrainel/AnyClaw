/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { createElement } from "react";

// ---------------------------------------------------------------------------
// Mock dispatch API
// ---------------------------------------------------------------------------
const { mockListTasks, mockCreateTask } = vi.hoisted(() => {
  const mockListTasks = vi.fn();
  const mockCreateTask = vi.fn();
  return { mockListTasks, mockCreateTask };
});

vi.mock("../src/lib/dispatch-api.js", () => ({
  listTasks: mockListTasks,
  createTask: mockCreateTask,
  getTask: vi.fn(),
  cancelTask: vi.fn(),
}));

import { Welcome } from "../src/pages/Welcome.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockListTasks.mockResolvedValue([]);
  mockCreateTask.mockImplementation(({ taskId, request }) =>
    Promise.resolve({ taskId, state: "queued", seq: 0, request }),
  );
});

afterEach(() => {
  cleanup();
});

describe("Welcome", () => {
  it("renders header and input", () => {
    render(createElement(Welcome));
    expect(screen.getByText("AnyClaw")).toBeDefined();
    expect(screen.getByPlaceholderText(/e.g. Build me/)).toBeDefined();
    expect(screen.getByText("Request")).toBeDefined();
  });

  it("shows empty state when no tasks", async () => {
    render(createElement(Welcome));
    await waitFor(() => {
      expect(screen.getByText(/No tasks yet/)).toBeDefined();
    });
  });

  it("lists tasks after load", async () => {
    mockListTasks.mockResolvedValue([
      { taskId: "t1", state: "queued", seq: 0, request: "Build a tracker" },
      { taskId: "t2", state: "done", seq: 3, request: "Add auth" },
    ]);

    render(createElement(Welcome));

    await waitFor(() => {
      expect(screen.getByText("Build a tracker")).toBeDefined();
    });
    expect(screen.getByText("Add auth")).toBeDefined();
  });

  it("creates a task on submit", async () => {
    render(createElement(Welcome));

    const input = screen.getByPlaceholderText(/e.g. Build me/);
    fireEvent.change(input, { target: { value: "Build me a mood tracker" } });

    const btn = screen.getByText("Request");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ request: "Build me a mood tracker" }),
      );
    });
  });

  it("shows task states with icons", async () => {
    mockListTasks.mockResolvedValue([
      { taskId: "t1", state: "working", seq: 1, request: "Working task", progressSummary: "Building..." },
      { taskId: "t2", state: "failed", seq: 2, request: "Failed task", error: "oops" },
      { taskId: "t3", state: "done", seq: 3, request: "Done task" },
    ]);

    render(createElement(Welcome));

    await waitFor(() => {
      expect(screen.getByText("Working")).toBeDefined();
    });
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
    expect(screen.getByText("Building...")).toBeDefined();
    expect(screen.getByText("oops")).toBeDefined();
  });

  it("contains no hardcoded hex colors in source", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "pages", "Welcome.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(src).not.toMatch(/bg-(red|blue|green)-/);
  });

  it("source file is under 300 lines", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "pages", "Welcome.tsx"),
      "utf-8",
    );
    const lineCount = src.split("\n").length;
    expect(lineCount).toBeLessThan(300);
  });
});
