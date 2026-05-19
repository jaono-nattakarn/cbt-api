import type { FastifyPluginAsync } from "fastify";
import { ok } from "../../utils/response";
import { standardErrors } from "../../schemas/common";
import { CTSR_ANCHORS, CTSR_ITEMS } from "./ctsr.data";

async function listItems(fastify: Parameters<FastifyPluginAsync>[0]) {
  if (!fastify.pg) return CTSR_ITEMS;
  const result = await fastify.pg.query(`
    select id, code, name_en as "nameEn", name_th as "nameTh",
      short_name as "shortName", category
    from ctsr_items
    where active = true
    order by display_order
  `);
  return result.rows;
}

async function listAnchors(fastify: Parameters<FastifyPluginAsync>[0], itemId: number) {
  if (!fastify.pg) return CTSR_ANCHORS;
  const result = await fastify.pg.query(
    `
      select score, label, coalesce(description_en, label) as "displayLabel"
      from ctsr_rubric_anchors
      where ctsr_item_id = $1
      order by score
    `,
    [itemId],
  );
  return result.rows;
}

const ctsrItemSchema = {
  type: "object",
  required: ["id", "code", "nameEn", "shortName", "category"],
  properties: {
    id: { type: "integer", minimum: 1, maximum: 12 },
    code: { type: "string" },
    nameEn: { type: "string" },
    nameTh: { type: "string" },
    shortName: { type: "string" },
    category: { type: "string", enum: ["Structure", "Technique", "Relationship"] },
  },
} as const;

const anchorSchema = {
  type: "object",
  required: ["score", "label", "displayLabel"],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 6 },
    label: { type: "string" },
    displayLabel: { type: "string" },
  },
} as const;

export const ctsrRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/ctsr/items",
    {
      schema: {
        tags: ["CTS-R Reference"],
        operationId: "listCtsrItems",
        summary: "List CTS-R 12 reference items",
        response: { 200: { type: "object", properties: { data: { type: "array", items: ctsrItemSchema }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => ok(request, await listItems(fastify)),
  );

  fastify.get(
    "/ctsr/items/:id",
    {
      schema: {
        tags: ["CTS-R Reference"],
        operationId: "getCtsrItem",
        summary: "Get CTS-R item detail",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "integer", minimum: 1, maximum: 12 } },
        },
        response: { 200: { type: "object", properties: { data: ctsrItemSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const id = Number((request.params as { id: number }).id);
      const items = await listItems(fastify);
      return ok(request, items.find((item) => item.id === id));
    },
  );

  fastify.get(
    "/ctsr/items/:id/rubrics",
    {
      schema: {
        tags: ["CTS-R Reference"],
        operationId: "listCtsrRubrics",
        summary: "List 0-6 anchors for a CTS-R item",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "integer", minimum: 1, maximum: 12 } },
        },
        response: { 200: { type: "object", properties: { data: { type: "array", items: anchorSchema }, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const id = Number((request.params as { id: number }).id);
      return ok(request, await listAnchors(fastify, id));
    },
  );
};
