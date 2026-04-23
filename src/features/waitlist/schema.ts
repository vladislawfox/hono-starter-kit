import { boolean, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const waitlistEntries = pgTable("waitlist_entries", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => Bun.randomUUIDv7()),
  email: varchar("email", { length: 255 }).notNull().unique(),
  isNotified: boolean("is_notified").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type WaitlistEntry = typeof waitlistEntries.$inferSelect;
