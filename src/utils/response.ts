import type { FastifyRequest } from "fastify";

export function ok<T>(request: FastifyRequest, data: T) {
  return {
    data,
    meta: {
      requestId: request.id,
    },
  };
}

export function paginated<T>(
  request: FastifyRequest,
  data: T[],
  limit: number,
  nextCursor: string | null,
) {
  return {
    data,
    pageInfo: {
      limit,
      nextCursor,
      hasNextPage: nextCursor !== null,
    },
    meta: {
      requestId: request.id,
    },
  };
}
