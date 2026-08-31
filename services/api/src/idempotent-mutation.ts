import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";

type AuthenticatedMutationRequest = Request & {
  staff?: { id: string; restaurantId: string };
};

export function mutationRequestHash(method: string, path: string, body: unknown) {
  return createHash("sha256").update(JSON.stringify({ method: method.toUpperCase(), path, body: body ?? null })).digest("hex");
}

export function createIdempotentMutationMiddleware(prisma: PrismaClient) {
  return async function idempotentMutation(req: AuthenticatedMutationRequest, res: Response, next: NextFunction) {
    const rawKey = req.headers["idempotency-key"];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!key) return next();
    if (!/^[A-Za-z0-9._:-]{16,160}$/.test(key)) {
      return res.status(400).json({ message: "Idempotency-Key must contain 16–160 safe characters", code: "INVALID_IDEMPOTENCY_KEY" });
    }
    if (!req.staff) return res.status(401).json({ message: "Authentication required" });

    const requestHash = mutationRequestHash(req.method, req.path, req.body);
    const identity = { restaurantId: req.staff.restaurantId, actorId: req.staff.id, key };
    const existing = await prisma.mutationIdempotencyKey.findUnique({
      where: { restaurantId_actorId_key: identity },
    });
    if (existing) {
      if (existing.method !== req.method || existing.path !== req.path || existing.requestHash !== requestHash) {
        return res.status(409).json({ message: "That idempotency key was already used for a different request", code: "IDEMPOTENCY_KEY_REUSED" });
      }
      if (existing.status === "COMPLETED" && existing.statusCode && existing.responseBody !== null) {
        res.set("Idempotency-Replayed", "true");
        return res.status(existing.statusCode).json(existing.responseBody);
      }
      res.set("Retry-After", "2");
      return res.status(409).json({ message: "The original request is still processing", code: "IDEMPOTENCY_IN_PROGRESS" });
    }

    try {
      await prisma.mutationIdempotencyKey.create({
        data: {
          ...identity,
          method: req.method,
          path: req.path,
          requestHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        res.set("Retry-After", "2");
        return res.status(409).json({ message: "The original request is still processing", code: "IDEMPOTENCY_IN_PROGRESS" });
      }
      throw error;
    }

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const statusCode = res.statusCode;
      if (statusCode >= 200 && statusCode < 300) {
        void prisma.mutationIdempotencyKey.update({
          where: { restaurantId_actorId_key: identity },
          data: { status: "COMPLETED", statusCode, responseBody: body as Prisma.InputJsonValue, completedAt: new Date() },
        }).then(() => originalJson(body)).catch(next);
        return res;
      }
      void prisma.mutationIdempotencyKey.delete({
        where: { restaurantId_actorId_key: identity },
      }).catch(() => undefined).finally(() => originalJson(body));
      return res;
    }) as typeof res.json;
    return next();
  };
}
