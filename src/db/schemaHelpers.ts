import { uuid, timestamp } from "drizzle-orm/pg-core"

//helpers for repetitive code
export const id = uuid().defaultRandom().primaryKey()
export const createdAt = timestamp().defaultNow().notNull()
export const updatedAt = timestamp()
  .defaultNow()
  .notNull()
  .$onUpdate(() => new Date())
export const deletedAt = timestamp()
