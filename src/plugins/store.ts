import fp from "fastify-plugin";
import { MemoryStore } from "../store/memory-store";
import { PostgresStore } from "../store/postgres-store";

export const storePlugin = fp(async (fastify) => {
  const store = fastify.pg ? new PostgresStore(fastify.pg, fastify.log) : new MemoryStore();
  await store.seed();
  if (store instanceof PostgresStore) {
    fastify.addHook("onClose", async () => {
      await store.flush();
    });
  }
  fastify.decorate("store", store);
});
