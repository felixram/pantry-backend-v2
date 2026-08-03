/**
 * Tax rate resolution helper.
 * Hierarchy: Product exempt? → Product override → Category exempt? → Category override → Location default → null
 */

interface TaxResolutionInput {
  product?: {
    is_tax_exempt?: boolean | null
    tax_rate_id?: string | null
  } | null
  category?: {
    is_tax_exempt?: boolean | null
    tax_rate_id?: string | null
  } | null
  locationTaxRateId?: string | null
}

interface TaxResolutionResult {
  taxRateId: string | null
  isExempt: boolean
}

export function resolveApplicableTaxRate(input: TaxResolutionInput): TaxResolutionResult {
  const { product, category, locationTaxRateId } = input

  // 1. Product-level exempt
  if (product?.is_tax_exempt) {
    return { taxRateId: null, isExempt: true }
  }

  // 2. Product-level override
  if (product?.tax_rate_id) {
    return { taxRateId: product.tax_rate_id, isExempt: false }
  }

  // 3. Category-level exempt
  if (category?.is_tax_exempt) {
    return { taxRateId: null, isExempt: true }
  }

  // 4. Category-level override
  if (category?.tax_rate_id) {
    return { taxRateId: category.tax_rate_id, isExempt: false }
  }

  // 5. Location default
  if (locationTaxRateId) {
    return { taxRateId: locationTaxRateId, isExempt: false }
  }

  // 6. No tax rate found
  return { taxRateId: null, isExempt: false }
}
