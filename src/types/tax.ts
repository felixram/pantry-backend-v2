export const TAX_TYPE = {
  purchase: "purchase",
  sales: "sales",
  both: "both",
} as const

export type TaxType = (typeof TAX_TYPE)[keyof typeof TAX_TYPE]
