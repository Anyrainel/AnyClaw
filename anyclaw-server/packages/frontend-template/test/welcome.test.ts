/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { createElement } from "react";

const { mockListTasks, mockCreateTask, mockCancelTask } = vi.hoisted(() => {
  const mockListTasks = vi.fn();
  const mockCreateTask = vi.fn();
  const mockCancelTask = vi.fn();
  return { mockListTasks, mockCreateTask, mockCancelTask };
});

vi.mock("../src/lib/dispatch-api.js", () => ({
  listTasks: mockListTasks,
  createTask: mockCreateTask,
  getTask: vi.fn(),
  cancelTask: mockCancelTask,
}));

vi.mock("../src/hooks/usePreferences.js", () => ({
  usePreferences: () => ({
    theme: "system",
    fontSize: "medium",
    fontFamily: "sans",
    accent: "blue",
    language: "en-US",
  }),
}));

import { Welcome } from "../src/pages/Welcome.js";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockListTasks.mockResolvedValue([]);
  mockCreateTask.mockImplementation(({ taskId, request }) =>
    Promise.resolve({ taskId, state: "queued", seq: 0, request }),
  );
  mockCancelTask.mockImplementation((taskId) =>
    Promise.resolve({ taskId, state: "cancelled", seq: 1 }),
  );
});

afterEach(() => {
  cleanup();
});

describe("Welcome app shell", () => {
  it("renders level one, level two, and level three navigation", () => {
    render(createElement(Welcome));
    expect(screen.getByRole("heading", { name: "Home" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Work" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Overview" })).toBeDefined();
    expect(screen.getByLabelText("Current location").textContent).toContain("Workspace");
  });

  it("shows starter sections for immediate use", () => {
    render(createElement(Welcome));
    expect(screen.getByRole("heading", { name: "Today" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Requests" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Versions" })).toBeDefined();
  });

  it("opens settings and applies local theme choices", () => {
    const { container } = render(createElement(Welcome));
    fireEvent.click(screen.getAllByLabelText("Open settings")[0]!);

    const theme = screen.getByLabelText("Theme mode");
    fireEvent.change(theme, { target: { value: "dark" } });

    const shell = container.querySelector(".app-shell");
    expect(shell?.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("anyclaw_shell_preferences")).toContain('"theme":"dark"');
  });

  it("opens the dispatch assistant and shows empty state", async () => {
    render(createElement(Welcome));
    fireEvent.click(screen.getByLabelText("Open dispatch assistant"));

    await waitFor(() => {
      expect(mockListTasks).toHaveBeenCalled();
    });
    expect(screen.getByText("No requests yet.")).toBeDefined();
  });

  it("creates a dispatch task from the assistant composer", async () => {
    render(createElement(Welcome));
    fireEvent.click(screen.getByLabelText("Open dispatch assistant"));

    const input = screen.getByPlaceholderText(/Build a simple habit tracker/);
    fireEvent.change(input, { target: { value: "Build me a mood tracker" } });
    fireEvent.click(screen.getByLabelText("Submit request"));

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ request: "Build me a mood tracker" }),
      );
    });
  });

  it("lists progress, errors, and version details from dispatch tasks", async () => {
    mockListTasks.mockResolvedValue([
      {
        taskId: "t1",
        state: "working",
        seq: 1,
        request: "Working task",
        progressSummary: "Building...",
      },
      {
        taskId: "t2",
        state: "failed",
        seq: 2,
        request: "Failed task",
        error: "oops",
      },
      {
        taskId: "t3",
        state: "done",
        seq: 3,
        request: "Done task",
        version: "v4",
        commitSha: "abcdef123456",
        deploymentUrl: "https://app.example",
      },
    ]);

    render(createElement(Welcome));
    fireEvent.click(screen.getByLabelText("Open dispatch assistant"));

    await waitFor(() => {
      expect(screen.getByText("Working task")).toBeDefined();
    });
    expect(screen.getByText("Building...")).toBeDefined();
    expect(screen.getByText("oops")).toBeDefined();
    expect(screen.getByText(/Version v4/)).toBeDefined();
    expect(screen.getByText(/Commit abcdef1/)).toBeDefined();
  });

  it("contains no hardcoded hex colors in Welcome source", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "pages", "Welcome.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
