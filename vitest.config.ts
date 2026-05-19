import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    globals: true,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/*.test.*",
        "src/test/**",
        "src/db/migrations/**",
        "src/app/**/loading.tsx",
        "src/app/**/error.tsx",
        "src/app/**/layout.tsx",
        "src/app/**/page.tsx",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
})
