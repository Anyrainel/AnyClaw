import PocketBase from "pocketbase";
import { QueryClient } from "@tanstack/react-query";

export const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL ?? "http://127.0.0.1:8090");

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
