import type { FastifyPluginAsync } from "fastify";
import bcrypt from "bcryptjs";
import { addDays, createOpaqueToken, nowIso, sha256 } from "../../utils/ids";
import { ok } from "../../utils/response";
import { standardErrors } from "../../schemas/common";
import { userSchema } from "../../schemas/entities";
import type { AuthenticatedUser, UserRecord } from "../../store/types";

function jwtUser(user: UserRecord): AuthenticatedUser {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    role: user.role,
    name: user.name,
  };
}

function publicUser(user: UserRecord) {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    affiliation: user.affiliation ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

const authTokenResponse = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: {
      type: "object",
      required: ["accessToken", "refreshToken", "expiresIn", "user"],
      properties: {
        accessToken: { type: "string" },
        refreshToken: { type: "string" },
        expiresIn: { type: "integer" },
        user: userSchema,
      },
    },
    meta: { type: "object", additionalProperties: true },
  },
} as const;

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/register",
    {
      schema: {
        tags: ["Auth"],
        operationId: "register",
        summary: "Register a new organization supervisor account",
        body: {
          type: "object",
          required: ["name", "email", "password"],
          properties: {
            organizationName: { type: "string" },
            name: { type: "string", minLength: 1 },
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            role: { type: "string", enum: ["admin", "supervisor", "therapist", "viewer"], default: "supervisor" },
          },
        },
        response: { 201: authTokenResponse, ...standardErrors },
      },
    },
    async (request, reply) => {
      const body = request.body as { organizationName?: string; name: string; email: string; password: string; role?: "admin" | "supervisor" | "therapist" | "viewer" };
      const user = await fastify.store.registerUser(body);
      const refresh = fastify.store.issueRefreshToken(user.id, fastify.config.REFRESH_TOKEN_TTL_DAYS);
      const accessToken = fastify.jwt.sign(jwtUser(user));
      reply.status(201).send(ok(request, { accessToken, refreshToken: refresh.token, expiresIn: fastify.config.ACCESS_TOKEN_TTL_SECONDS, user: publicUser(user) }));
    },
  );

  fastify.post(
    "/login",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "15 minutes" },
      },
      schema: {
        tags: ["Auth"],
        operationId: "login",
        summary: "Authenticate with email and password",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 1 },
          },
        },
        response: { 200: authTokenResponse, ...standardErrors },
      },
    },
    async (request) => {
      const body = request.body as { email: string; password: string };
      const user = await fastify.store.verifyLogin(body.email, body.password);
      const refresh = fastify.store.issueRefreshToken(user.id, fastify.config.REFRESH_TOKEN_TTL_DAYS);
      const accessToken = fastify.jwt.sign(jwtUser(user));
      return ok(request, { accessToken, refreshToken: refresh.token, expiresIn: fastify.config.ACCESS_TOKEN_TTL_SECONDS, user: publicUser(user) });
    },
  );

  fastify.post(
    "/refresh",
    {
      schema: {
        tags: ["Auth"],
        operationId: "refreshToken",
        summary: "Rotate refresh token and issue a new access token",
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string" },
          },
        },
        response: { 200: authTokenResponse, ...standardErrors },
      },
    },
    async (request) => {
      const body = request.body as { refreshToken: string };
      const rotated = fastify.store.rotateRefreshToken(body.refreshToken, fastify.config.REFRESH_TOKEN_TTL_DAYS);
      const accessToken = fastify.jwt.sign(jwtUser(rotated.user));
      return ok(request, { accessToken, refreshToken: rotated.token, expiresIn: fastify.config.ACCESS_TOKEN_TTL_SECONDS, user: publicUser(rotated.user) });
    },
  );

  fastify.post(
    "/logout",
    {
      schema: {
        tags: ["Auth"],
        operationId: "logout",
        summary: "Revoke the current refresh token",
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string" },
          },
        },
        response: { 200: { type: "object", properties: { data: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const body = request.body as { refreshToken: string };
      fastify.store.revokeRefreshToken(body.refreshToken);
      return ok(request, { revoked: true });
    },
  );

  fastify.post(
    "/logout-all",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Auth"],
        operationId: "logoutAll",
        summary: "Revoke all refresh tokens for the current user",
        security: [{ bearerAuth: [] }],
        response: { 200: { type: "object", properties: { data: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      fastify.store.revokeUserRefreshTokens(request.authUser!.id);
      return ok(request, { revoked: true });
    },
  );

  fastify.get(
    "/me",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Auth"],
        operationId: "getCurrentUser",
        summary: "Get current authenticated user",
        security: [{ bearerAuth: [] }],
        response: { 200: { type: "object", properties: { data: userSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => ok(request, publicUser(fastify.store.getUserById(request.authUser!.id))),
  );

  fastify.patch(
    "/me",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Auth"],
        operationId: "updateCurrentUser",
        summary: "Update current user profile",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            affiliation: { type: "string" },
          },
        },
        response: { 200: { type: "object", properties: { data: userSchema, meta: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const body = request.body as { name?: string; affiliation?: string };
      const user = fastify.store.updateUser(request.authUser!.id, body);
      return ok(request, publicUser(user));
    },
  );

  fastify.patch(
    "/me/password",
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ["Auth"],
        operationId: "changePassword",
        summary: "Change current user password",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string" },
            newPassword: { type: "string", minLength: 8 },
          },
        },
        response: { 200: { type: "object", properties: { data: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const body = request.body as { currentPassword: string; newPassword: string };
      const user = fastify.store.getUserById(request.authUser!.id);
      const valid = await bcrypt.compare(body.currentPassword, user.passwordHash);
      if (!valid) throw new Error("Current password is invalid");
      user.passwordHash = await bcrypt.hash(body.newPassword, 10);
      user.updatedAt = nowIso();
      fastify.store.revokeUserRefreshTokens(user.id);
      return ok(request, { changed: true });
    },
  );

  fastify.post(
    "/forgot-password",
    {
      schema: {
        tags: ["Auth"],
        operationId: "forgotPassword",
        summary: "Create a password reset token",
        body: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string", format: "email" } },
        },
        response: { 200: { type: "object", properties: { data: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const body = request.body as { email: string };
      const user = fastify.store.findUserByEmail(body.email);
      const token = user ? createOpaqueToken() : null;
      if (user && token) {
        fastify.store.addAudit({
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "auth.password_reset_requested",
          entityType: "user",
          entityId: user.id,
          afterData: { tokenHash: sha256(token), expiresAt: addDays(new Date(), 1).toISOString() },
        });
      }
      return ok(request, { sent: true, resetToken: fastify.config.NODE_ENV === "development" ? token : undefined });
    },
  );

  fastify.post(
    "/reset-password",
    {
      schema: {
        tags: ["Auth"],
        operationId: "resetPassword",
        summary: "Reset password with a token",
        body: {
          type: "object",
          required: ["token", "newPassword"],
          properties: {
            token: { type: "string" },
            newPassword: { type: "string", minLength: 8 },
          },
        },
        response: { 200: { type: "object", properties: { data: { type: "object" } } }, ...standardErrors },
      },
    },
    async (request) => {
      const body = request.body as { token: string; newPassword: string };
      return ok(request, { reset: true, tokenHash: sha256(body.token), note: "Wire token lookup to password_reset_tokens when Postgres store is enabled." });
    },
  );
};
