import { buildApp } from "./app";

async function main() {
  const app = await buildApp();
  await app.listen({ port: app.config.PORT, host: app.config.HOST });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
