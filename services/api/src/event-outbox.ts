import { OutboxEventStatus, Prisma, type PrismaClient } from "@prisma/client";

export type OutboxEventInput = {
  restaurantId?: string;
  topic: string;
  aggregateType: string;
  aggregateId?: string;
  payload: Record<string, unknown>;
};

export type OutboxDelivery = (event: {
  id: string;
  restaurantId: string | null;
  topic: string;
  aggregateType: string;
  aggregateId: string | null;
  payload: unknown;
  createdAt: Date;
}) => Promise<void>;

const MAX_ATTEMPTS = 12;
const LOCK_TIMEOUT_MS = 60_000;

export function retryDelayMs(attempt: number) {
  return Math.min(5 * 60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export async function enqueueOutboxEvent(prisma: PrismaClient, input: OutboxEventInput) {
  return prisma.domainEventOutbox.create({
    data: {
      restaurantId: input.restaurantId,
      topic: input.topic,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload as Prisma.InputJsonValue,
    },
  });
}

export async function recoverStaleOutboxLocks(prisma: PrismaClient, now = new Date()) {
  const staleBefore = new Date(now.getTime() - LOCK_TIMEOUT_MS);
  return prisma.domainEventOutbox.updateMany({
    where: { status: OutboxEventStatus.PROCESSING, lockedAt: { lt: staleBefore } },
    data: { status: OutboxEventStatus.PENDING, lockedAt: null, availableAt: now },
  });
}

export async function processOutboxBatch(prisma: PrismaClient, deliver: OutboxDelivery, batchSize = 50, now = new Date()) {
  await recoverStaleOutboxLocks(prisma, now);
  const candidates = await prisma.domainEventOutbox.findMany({
    where: { status: OutboxEventStatus.PENDING, availableAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(100, batchSize)),
  });
  let delivered = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const claimed = await prisma.domainEventOutbox.updateMany({
      where: { id: candidate.id, status: OutboxEventStatus.PENDING },
      data: { status: OutboxEventStatus.PROCESSING, lockedAt: now, attempts: { increment: 1 } },
    });
    if (!claimed.count) continue;
    try {
      await deliver(candidate);
      await prisma.domainEventOutbox.update({
        where: { id: candidate.id },
        data: { status: OutboxEventStatus.DELIVERED, deliveredAt: new Date(), lockedAt: null, lastError: null },
      });
      delivered += 1;
    } catch (error) {
      const attempts = candidate.attempts + 1;
      const terminal = attempts >= MAX_ATTEMPTS;
      await prisma.domainEventOutbox.update({
        where: { id: candidate.id },
        data: {
          status: terminal ? OutboxEventStatus.FAILED : OutboxEventStatus.PENDING,
          lockedAt: null,
          availableAt: new Date(now.getTime() + retryDelayMs(attempts)),
          lastError: (error instanceof Error ? error.message : "Unknown delivery error").slice(0, 1000),
        },
      });
      failed += 1;
    }
  }
  return { scanned: candidates.length, delivered, failed };
}
