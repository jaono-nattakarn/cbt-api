import { buildApp } from "../app";

async function main() {
  const app = await buildApp();
  app.log.info("Analysis worker bootstrap complete. Persistent Postgres queue claiming is planned for the database-backed store.");
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
