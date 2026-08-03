import { eq, and, isNull, ilike } from "drizzle-orm"
import { Supplier } from "../../db/schema/supplier.ts"
import { PurchaseOrder } from "../../db/schema/purchaseOrder.ts"
import type { InvoiceExtractionResult } from "../ai/geminiService.ts"
import type { db as dbType } from "../../db/index.ts"

interface SupplierMatchResult {
  supplierId: string | null
  confidence: number
  method: string
}

/**
 * Levenshtein distance for fuzzy string matching.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1,
          matrix[i]![j - 1]! + 1,
          matrix[i - 1]![j]! + 1
        )
      }
    }
  }

  return matrix[b.length]![a.length]!
}

/**
 * Calculate similarity score (0-1) between two strings.
 */
function stringSimilarity(a: string, b: string): number {
  const la = a.toLowerCase().trim()
  const lb = b.toLowerCase().trim()
  if (la === lb) return 1

  const maxLen = Math.max(la.length, lb.length)
  if (maxLen === 0) return 1

  return 1 - levenshteinDistance(la, lb) / maxLen
}

/**
 * Strip common business suffixes and normalize for comparison.
 * "NY MUTUAL TRADING, INC." → "ny mutual trading"
 * "Mutual Trading Company" → "mutual trading"
 */
const BUSINESS_SUFFIXES = /\b(inc|incorporated|llc|ltd|limited|co|corp|corporation|company|group|enterprises|int'l|international)\b\.?/gi

function normalizeSupplierName(name: string): string {
  return name
    .replace(BUSINESS_SUFFIXES, "")
    .replace(/[,.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/**
 * Match extracted invoice data to an existing supplier in the database.
 *
 * Priority:
 * 1. PO reference → find PO → get supplier_id
 * 2. Email exact match
 * 3. Name exact match (case-insensitive)
 * 4. Name fuzzy match (Levenshtein similarity)
 */
export async function matchSupplier(
  db: typeof dbType,
  tenantId: string,
  extracted: InvoiceExtractionResult,
  fromEmail?: string | null
): Promise<SupplierMatchResult> {
  // 1. PO reference match
  if (extracted.po_reference) {
    const po = await db.query.PurchaseOrder.findFirst({
      where: and(
        eq(PurchaseOrder.po_number, extracted.po_reference),
        eq(PurchaseOrder.tenant_id, tenantId),
        isNull(PurchaseOrder.deletedAt)
      ),
    })
    if (po?.supplier_id) {
      return { supplierId: po.supplier_id, confidence: 1.0, method: "po_reference" }
    }
  }

  // Get all active suppliers for this tenant
  const suppliers = await db.query.Supplier.findMany({
    where: and(
      eq(Supplier.tenant_id, tenantId),
      isNull(Supplier.deletedAt)
    ),
  })

  // 2. Email exact match (extracted email from invoice content)
  if (extracted.supplier.email) {
    const emailMatch = suppliers.find(
      (s) => s.email?.toLowerCase() === extracted.supplier.email!.toLowerCase()
    )
    if (emailMatch) {
      return { supplierId: emailMatch.id, confidence: 0.95, method: "email_exact" }
    }
  }

  // 2b. From email match (the actual sender email address)
  if (fromEmail) {
    const fromEmailMatch = suppliers.find(
      (s) => s.email?.toLowerCase() === fromEmail.toLowerCase()
    )
    if (fromEmailMatch) {
      return { supplierId: fromEmailMatch.id, confidence: 0.93, method: "from_email_exact" }
    }

    // Also check if the sender domain matches a supplier email domain
    const fromDomain = fromEmail.split("@")[1]?.toLowerCase()
    if (fromDomain && fromDomain !== "gmail.com" && fromDomain !== "yahoo.com" && fromDomain !== "hotmail.com" && fromDomain !== "outlook.com") {
      const domainMatch = suppliers.find((s) => {
        const supplierDomain = s.email?.split("@")[1]?.toLowerCase()
        return supplierDomain === fromDomain
      })
      if (domainMatch) {
        return { supplierId: domainMatch.id, confidence: 0.85, method: "email_domain" }
      }
    }
  }

  // 3. Name exact match (case-insensitive)
  const nameExact = suppliers.find(
    (s) => s.name.toLowerCase() === extracted.supplier.name.toLowerCase()
  )
  if (nameExact) {
    return { supplierId: nameExact.id, confidence: 0.9, method: "name_exact" }
  }

  // 4. Normalized name match (strips suffixes like INC, LLC, CO, etc.)
  const normalizedExtracted = normalizeSupplierName(extracted.supplier.name)
  const normalizedExact = suppliers.find(
    (s) => normalizeSupplierName(s.name) === normalizedExtracted
  )
  if (normalizedExact) {
    return { supplierId: normalizedExact.id, confidence: 0.88, method: "name_normalized" }
  }

  // 5. Contains match — one name contains the other (after normalization)
  const containsMatch = suppliers.find((s) => {
    const ns = normalizeSupplierName(s.name)
    return (
      (ns.length >= 4 && normalizedExtracted.includes(ns)) ||
      (normalizedExtracted.length >= 4 && ns.includes(normalizedExtracted))
    )
  })
  if (containsMatch) {
    return { supplierId: containsMatch.id, confidence: 0.82, method: "name_contains" }
  }

  // 6. Fuzzy match (on both raw and normalized names, take the better score)
  let bestMatch: { supplier: typeof suppliers[0]; similarity: number } | null = null
  for (const supplier of suppliers) {
    const rawSim = stringSimilarity(supplier.name, extracted.supplier.name)
    const normSim = stringSimilarity(
      normalizeSupplierName(supplier.name),
      normalizedExtracted
    )
    const similarity = Math.max(rawSim, normSim)

    if (similarity > 0.6 && (!bestMatch || similarity > bestMatch.similarity)) {
      bestMatch = { supplier, similarity }
    }
  }

  if (bestMatch) {
    return {
      supplierId: bestMatch.supplier.id,
      confidence: bestMatch.similarity * 0.85,
      method: "name_fuzzy",
    }
  }

  return { supplierId: null, confidence: 0, method: "unmatched" }
}
