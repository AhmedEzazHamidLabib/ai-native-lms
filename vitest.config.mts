import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The *.integration.test.ts files are live tests against one
    // shared hosted Supabase project/course (no mocks — see
    // docs/DECISIONS.md). Running them in parallel worker files races
    // on the same course_members rows and even the same course's
    // schedule/settings columns. Sequential file execution trades some
    // wall-clock time for correctness against shared live state.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
