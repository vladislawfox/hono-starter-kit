import { defineConfig } from "drizzle-kit";

const dbUrl = process.env["DATABASE_URL"];
if (!dbUrl) {
  throw new Error("DATABASE_URL must be set to run drizzle-kit commands.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/features/**/schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: dbUrl,
  },
});
