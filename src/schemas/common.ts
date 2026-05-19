export const uuidParamSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", format: "uuid" },
  },
} as const;

export const sessionParamSchema = {
  type: "object",
  required: ["sessionId"],
  properties: {
    sessionId: { type: "string", format: "uuid" },
  },
} as const;

export const itemParamSchema = {
  type: "object",
  required: ["sessionId", "itemId"],
  properties: {
    sessionId: { type: "string", format: "uuid" },
    itemId: { type: "integer", minimum: 1, maximum: 12 },
  },
} as const;

export const paginationQuerySchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    cursor: { type: "string" },
    q: { type: "string" },
  },
} as const;

export const pageInfoSchema = {
  type: "object",
  required: ["limit", "hasNextPage"],
  properties: {
    limit: { type: "integer" },
    nextCursor: { type: ["string", "null"] },
    hasNextPage: { type: "boolean" },
  },
} as const;

export const errorResponseSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "requestId"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {},
        requestId: { type: "string" },
      },
    },
  },
} as const;

export const emptyResponseSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: { type: "object", additionalProperties: true },
  },
} as const;

export const idSchema = {
  type: "string",
  format: "uuid",
} as const;

export const isoDateTimeSchema = {
  type: "string",
  format: "date-time",
} as const;

export const nullableDateTimeSchema = {
  type: ["string", "null"],
  format: "date-time",
} as const;

export const standardErrors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  500: errorResponseSchema,
} as const;
