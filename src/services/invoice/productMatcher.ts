import { eq, and, isNull } from "drizzle-orm"
import { Product } from "../../db/schema/product.ts"
import { ProductAlias } from "../../db/schema/productAlias.ts"
import type { db as dbType } from "../../db/index.ts"

interface ProductMatchResult {
  productId: string | null
  confidence: number
  method: string // "sku_exact" | "alias_exact" | "name_exact" | "name_fuzzy" | "unmatched"
}

type AliasRow = {
  id: string
  alias_name: string
  product_id: string
  use_count: number
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

function stringSimilarity(a: string, b: string): number {
  const la = a.toLowerCase().trim()
  const lb = b.toLowerCase().trim()
  if (la === lb) return 1

  const maxLen = Math.max(la.length, lb.length)
  if (maxLen === 0) return 1

  return 1 - levenshteinDistance(la, lb) / maxLen
}

interface ExtractedItem {
  description: string
  sku?: string
  quantity: number
  unit?: string
  unit_price: number
  line_total: number
}

type ProductRow = Awaited<ReturnType<typeof dbType.query.Product.findMany>>[number]

/**
 * Match a single extracted line item to a product in the database.
 *
 * Priority:
 * 1. SKU exact match (highest confidence)
 * 2. Alias exact match (supplier-scoped, from human corrections)
 * 3. Name exact match scoped to supplier
 * 4. Name exact match across all products
 * 5. Name fuzzy match
 */
export async function matchProduct(
  db: typeof dbType,
  tenantId: string,
  item: ExtractedItem,
  matchedSupplierId: string | null,
  productCache?: ProductRow[],
  aliasCache?: AliasRow[]
): Promise<ProductMatchResult> {
  // Use cache or fetch products
  const products: ProductRow[] = productCache ?? await db.query.Product.findMany({
    where: and(
      eq(Product.tenant_id, tenantId),
      isNull(Product.deletedAt)
    ),
  })

  // 1. SKU exact match
  if (item.sku) {
    const skuMatch = products.find(
      (p) => p.sku?.toLowerCase() === item.sku!.toLowerCase()
    )
    if (skuMatch) {
      return { productId: skuMatch.id, confidence: 0.98, method: "sku_exact" }
    }
  }

  // 2. Alias exact match (supplier-scoped)
  if (aliasCache && item.description) {
    const normalizedDesc = item.description.toLowerCase().trim()
    const aliasMatch = aliasCache.find(
      (a) => a.alias_name.toLowerCase().trim() === normalizedDesc
    )
    if (aliasMatch) {
      // Confidence scales with use_count
      let confidence: number
      if (aliasMatch.use_count >= 5) {
        confidence = 0.97
      } else if (aliasMatch.use_count >= 2) {
        confidence = 0.95
      } else {
        confidence = 0.93
      }
      return { productId: aliasMatch.product_id, confidence, method: "alias_exact" }
    }
  }

  // 3. Name exact match scoped to matched supplier
  if (matchedSupplierId) {
    const supplierNameMatch = products.find(
      (p) =>
        p.supplier_id === matchedSupplierId &&
        p.name.toLowerCase() === item.description.toLowerCase()
    )
    if (supplierNameMatch) {
      return { productId: supplierNameMatch.id, confidence: 0.92, method: "name_exact" }
    }
  }

  // 4. Name exact match (any supplier)
  const nameExact = products.find(
    (p) => p.name.toLowerCase() === item.description.toLowerCase()
  )
  if (nameExact) {
    return { productId: nameExact.id, confidence: 0.88, method: "name_exact" }
  }

  // 5. SKU partial match — extracted SKU may be a barcode containing the DB SKU
  if (item.sku) {
    const extractedSku = item.sku.toLowerCase()
    const skuPartialMatch = products.find(
      (p) => p.sku && (
        extractedSku.includes(p.sku.toLowerCase()) ||
        p.sku.toLowerCase().includes(extractedSku)
      )
    )
    if (skuPartialMatch) {
      return { productId: skuPartialMatch.id, confidence: 0.90, method: "sku_partial" }
    }
  }

  // 6. Name contains match — short DB names within long invoice descriptions
  const descLower = item.description.toLowerCase().trim()
  if (matchedSupplierId) {
    const supplierContainsMatch = products.find(
      (p) =>
        p.supplier_id === matchedSupplierId &&
        p.name.length >= 3 &&
        descLower.includes(p.name.toLowerCase())
    )
    if (supplierContainsMatch) {
      return { productId: supplierContainsMatch.id, confidence: 0.87, method: "name_contains" }
    }
  }

  const anyContainsMatch = products.find(
    (p) => p.name.length >= 3 && descLower.includes(p.name.toLowerCase())
  )
  if (anyContainsMatch) {
    return { productId: anyContainsMatch.id, confidence: 0.82, method: "name_contains" }
  }

  // 7. Name fuzzy match
  let bestMatch: { product: ProductRow; similarity: number } | null = null

  for (const product of products) {
    const similarity = stringSimilarity(product.name, item.description)

    // Boost score if supplier matches
    const supplierBoost =
      matchedSupplierId && product.supplier_id === matchedSupplierId ? 0.05 : 0

    const adjustedSimilarity = similarity + supplierBoost

    if (adjustedSimilarity > 0.65 && (!bestMatch || adjustedSimilarity > bestMatch.similarity)) {
      bestMatch = { product, similarity: adjustedSimilarity }
    }
  }

  if (bestMatch) {
    return {
      productId: bestMatch.product.id,
      confidence: Math.min(bestMatch.similarity * 0.85, 0.85),
      method: "name_fuzzy",
    }
  }

  return { productId: null, confidence: 0, method: "unmatched" }
}

/**
 * Match all extracted items from an invoice to products.
 * Pre-fetches all products and aliases (for matched supplier) once for efficiency.
 */
export async function matchAllProducts(
  db: typeof dbType,
  tenantId: string,
  items: ExtractedItem[],
  matchedSupplierId: string | null
): Promise<ProductMatchResult[]> {
  // Pre-fetch all products once
  const products = await db.query.Product.findMany({
    where: and(
      eq(Product.tenant_id, tenantId),
      isNull(Product.deletedAt)
    ),
  })

  // Pre-fetch aliases for this supplier
  let aliases: AliasRow[] = []
  if (matchedSupplierId) {
    aliases = await db.query.ProductAlias.findMany({
      where: and(
        eq(ProductAlias.tenant_id, tenantId),
        eq(ProductAlias.supplier_id, matchedSupplierId)
      ),
      columns: {
        id: true,
        alias_name: true,
        product_id: true,
        use_count: true,
      },
    })
  }

  return Promise.all(
    items.map((item) =>
      matchProduct(db, tenantId, item, matchedSupplierId, products, aliases)
    )
  )
}
