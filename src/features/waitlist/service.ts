import { ConflictError } from "@/core/errors";
import { getLogger } from "@/core/logger";
import * as repo from "@/features/waitlist/repository";

export type WaitlistJoinResult = {
  email: string;
  createdAt: Date;
};

export async function joinWaitlist(email: string): Promise<WaitlistJoinResult> {
  const normalized = email.toLowerCase();

  const entry = await repo.createIfNew(normalized);
  if (!entry) {
    throw new ConflictError("This email is already on the waitlist");
  }

  getLogger().info({ email: normalized, id: entry.id }, "Waitlist entry created");

  return {
    email: entry.email,
    createdAt: entry.createdAt,
  };
}
