import { create } from "zustand";
import { apiClient } from "../api";

export interface Version {
  id: string;
  label: string;
  createdAt: string;
}

interface VersionsStore {
  versions: Version[];
  isLoading: boolean;
  error: string | null;

  fetchVersions: () => Promise<void>;
  rollbackTo: (versionId: string) => Promise<void>;
}

export const useVersionsStore = create<VersionsStore>((set, get) => ({
  versions: [],
  isLoading: false,
  error: null,

  fetchVersions: async () => {
    set({ isLoading: true, error: null });

    try {
      const result = (await apiClient.get("/api/versions")) as {
        versions: Version[];
      };
      set({
        versions: result.versions,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  rollbackTo: async (versionId: string) => {
    await apiClient.post("/api/rollback", { versionId });
    await get().fetchVersions();
  },
}));
