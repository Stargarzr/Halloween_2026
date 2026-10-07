import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./supabase/generated",
  schema: "./db/schema.ts",
  dialect: "postgresql",
});
