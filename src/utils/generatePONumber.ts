import { db } from "../db/index.ts"
import { POCounter } from "../db/schema/poCounter.ts"
import { eq, and } from "drizzle-orm"

/**
 * Generates next PO number in format: PO-YYYY-NNN
 * Example: PO-2026-001
 *
 * Uses database transaction to prevent race conditions
 * Each tenant has their own sequence
 */
export async function generatePONumber(tenantId: string): Promise<string> {
  const currentYear = new Date().getFullYear()

  return await db.transaction(async (tx) => {
    // Get counter for current year and tenant
    let counter = await tx.query.POCounter.findFirst({
      where: and(
        eq(POCounter.year, currentYear),
        eq(POCounter.tenant_id, tenantId)
      ),
    })

    if (!counter) {
      // First PO of the year for this tenant, create counter
      const [newCounter] = await tx
        .insert(POCounter)
        .values({ year: currentYear, last_sequence: 1, tenant_id: tenantId })
        .returning()

      if (!newCounter) {
        throw new Error("Failed to create PO counter")
      }

      return `PO-${currentYear}-001`
    }

    // Increment sequence
    const nextSequence = counter.last_sequence + 1

    await tx
      .update(POCounter)
      .set({ last_sequence: nextSequence })
      .where(and(
        eq(POCounter.year, currentYear),
        eq(POCounter.tenant_id, tenantId)
      ))

    // Format with leading zeros (3 digits)
    const sequenceStr = String(nextSequence).padStart(3, "0")
    return `PO-${currentYear}-${sequenceStr}`
  })
}
