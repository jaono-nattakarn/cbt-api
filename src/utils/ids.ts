import { randomBytes, randomUUID, createHash } from "node:crypto";

export function createPublicId(): string {
  return randomUUID();
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
