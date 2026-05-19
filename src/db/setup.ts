import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required. Copy .env.example to .env or set DATABASE_URL before running this script.");
  }
  return url;
}

async function runSqlDirectory(pool: Pool, relativeDir: string) {
  const dir = join(process.cwd(), relativeDir);
  const files = (await readdir(dir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = await readFile(join(dir, file), "utf8");
    process.stdout.write(`Applying ${relativeDir}/${file}... `);
    await pool.query(sql);
    process.stdout.write("done\n");
  }
}

export async function runDatabaseSetup() {
  const pool = new Pool({ connectionString: databaseUrl() });
  try {
    await runSqlDirectory(pool, "src/db/migrations");
    await runSqlDirectory(pool, "src/db/seeds");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runDatabaseSetup()
    .then(() => {
      console.log("Database setup complete.");
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
