import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests use process.chdir(), which mutates global state. Run all files in a single worker so
    // they don't interfere with each other.
    fileParallelism: false,
  },
});
