import fp from "fastify-plugin";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

declare module "fastify" {
  interface FastifyInstance {
    pg?: Pool;
  }
}

export const dbPlugin = fp(async (fastify) => {
  if (!fastify.config.DATABASE_URL) return;
  const pool = new Pool({
    connectionString: fastify.config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
  fastify.decorate("pg", pool);

  const migrationsDir = join(process.cwd(), "src", "db", "migrations");
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of migrationFiles) {
    const migration = await readFile(join(migrationsDir, file), "utf8");
    await pool.query(migration);
  }

  const seed = await readFile(
    join(process.cwd(), "src", "db", "seeds", "001_ctsr_reference.sql"),
    "utf8",
  );
  await pool.query(seed);

  fastify.addHook("onClose", async () => {
    await pool.end();
  });
});
