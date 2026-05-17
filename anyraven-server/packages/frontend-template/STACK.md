# Frontend Stack & Project Organization

This is the **opinionated default stack** for AnyRaven frontend work. The goal: eliminate decision fatigue on common stuff so the agent can focus on product logic.

## Stack

| Layer | Library | Purpose |
|---|---|---|
| Bundler | Vite 8 + Rolldown | Fast builds, Rust-based transformer |
| Styling | Tailwind CSS 4 | Utility-first, no CSS files to manage |
| Components | shadcn/ui + Radix | Accessible primitives, copy-paste ownership |
| Forms | react-hook-form + zod | Type-safe validation, minimal boilerplate |
| State (server) | TanStack Query | Caching, deduping, background updates |
| State (client) | Zustand | Lightweight, no providers needed |
| Routing | React Router v6 | Standard, well-documented |
| Icons | Lucide React | Consistent, tree-shakeable |

## Project Structure

```
src/
  components/
    ui/              # shadcn/ui primitives (Button, Input, Dialog, etc.)
    features/        # Domain-specific components (TaskCard, VersionBadge)
  hooks/
    usePreferences.ts
    useTaskStatus.ts
    useVersions.ts
  lib/
    api.ts           # TanStack Query setup + PocketBase client
    utils.ts         # cn() helper, formatters, etc.
    schemas.ts       # Zod schemas shared across forms
  stores/
    preferences.ts   # Zustand stores (one file per domain)
    connection.ts
  pages/
    Welcome.tsx
    Settings.tsx
  App.tsx
  main.tsx
```

## Rules

1. **Components**: UI primitives go in `components/ui/`, feature components in `components/features/`. Never import from `components/ui/` outside the project — copy the component if you need to fork it.
2. **Forms**: Every form has a Zod schema in `lib/schemas.ts`. Use `react-hook-form` with `zodResolver`. No uncontrolled inputs.
3. **Server State**: All PocketBase queries go through TanStack Query in `lib/api.ts`. No raw `pb.collection()` calls in components.
4. **Client State**: Zustand stores live in `stores/`. One store per domain. Use `persist` middleware for localStorage, `SecureStore` for mobile.
5. **Styling**: Tailwind only. No inline styles, no CSS modules. Use `cn()` from `lib/utils.ts` for conditional classes.

## Adding shadcn/ui Components

```bash
npx shadcn add button input dialog
```

Components are copied into `src/components/ui/` — fully owned, no dependency on a registry at build time.

## Example: Form with Validation

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z.object({
  name: z.string().min(1, "Required"),
  email: z.string().email("Invalid email"),
});

type FormData = z.infer<typeof schema>;

export function ContactForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  return (
    <form onSubmit={handleSubmit((data) => console.log(data))}>
      <Input {...register("name")} />
      {errors.name && <p>{errors.name.message}</p>}
      <Button type="submit">Submit</Button>
    </form>
  );
}
```

## Example: TanStack Query + PocketBase

```tsx
import { useQuery } from "@tanstack/react-query";
import { pb } from "@/lib/api";

export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: () => pb.collection("tasks").getFullList(),
  });
}
```

## Example: Zustand Store

```tsx
import { create } from "zustand";

interface PreferencesState {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
}

export const usePreferences = create<PreferencesState>((set) => ({
  theme: "light",
  setTheme: (theme) => set({ theme }),
}));
```
