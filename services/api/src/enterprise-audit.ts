import { createHash, randomUUID } from "node:crypto";
import { AuditActorType, Prisma, type PrismaClient } from "@prisma/client";

export type AuditActor = {
  type: AuditActorType;
  id?: string;
  role?: string;
};

export type AppendAuditEventInput = {
  restaurantId?: string;
  actor: AuditActor;
  action: string;
  resourceType: string;
  resourceId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
};

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

export function calculateAuditHash(input: {
  id: string;
  previousHash?: string | null;
  restaurantId?: string;
  actor: AuditActor;
  action: string;
  resourceType: string;
  resourceId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
}): string {
  return createHash("sha256").update(canonicalize({
    id: input.id,
    previousHash: input.previousHash || null,
    restaurantId: input.restaurantId || null,
    actorType: input.actor.type,
    actorId: input.actor.id || null,
    actorRole: input.actor.role || null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId || null,
    requestId: input.requestId || null,
    metadata: input.metadata || null,
    occurredAt: input.occurredAt.toISOString(),
  })).digest("hex");
}

export async function appendAuditEvent(prisma: PrismaClient, input: AppendAuditEventInput) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async tx => {
        const previous = await tx.enterpriseAuditEvent.findFirst({
          where: { restaurantId: input.restaurantId || null },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          select: { hash: true },
        });
        const id = randomUUID();
        const occurredAt = input.occurredAt || new Date();
        const hash = calculateAuditHash({
          ...input,
          id,
          previousHash: previous?.hash,
          occurredAt,
        });
        return tx.enterpriseAuditEvent.create({
          data: {
            id,
            restaurantId: input.restaurantId,
            actorType: input.actor.type,
            actorId: input.actor.id,
            actorRole: input.actor.role,
            action: input.action,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            requestId: input.requestId,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
            metadata: input.metadata as Prisma.InputJsonValue | undefined,
            previousHash: previous?.hash,
            hash,
            occurredAt,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw new Error("Audit append failed after retry");
}

export async function verifyAuditChain(prisma: PrismaClient, restaurantId?: string) {
  const events = await prisma.enterpriseAuditEvent.findMany({
    where: { restaurantId: restaurantId || null },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  let previousHash: string | null = null;
  for (const event of events) {
    const calculated = calculateAuditHash({
      id: event.id,
      previousHash,
      restaurantId: event.restaurantId || undefined,
      actor: { type: event.actorType, id: event.actorId || undefined, role: event.actorRole || undefined },
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId || undefined,
      requestId: event.requestId || undefined,
      metadata: event.metadata as Record<string, unknown> | undefined,
      occurredAt: event.occurredAt,
    });
    if (event.previousHash !== previousHash || event.hash !== calculated) {
      return { valid: false, checked: events.length, failedEventId: event.id };
    }
    previousHash = event.hash;
  }
  return { valid: true, checked: events.length, headHash: previousHash };
}
