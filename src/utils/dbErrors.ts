import { TRPCError } from "@trpc/server"

/**
 * PostgreSQL error codes for common constraint violations.
 * See: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_ERROR_CODES = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  NOT_NULL_VIOLATION: "23502",
  CHECK_VIOLATION: "23514",
} as const

/**
 * Maps known constraint names to user-friendly messages.
 * Add entries here as new constraints are discovered.
 */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  // User table
  user_email_unique: "A user with this email address already exists.",
  user_email_unique_active: "A user with this email address already exists.",
  user_invitation_token_unique: "This invitation has already been used.",
  user_password_reset_token_unique: "This password reset link has already been used.",
  // Tenant table
  tenant_slug_unique: "An organization with this name already exists.",
  // Location table
  location_place_id_unique: "This location has already been registered.",
  // Category table
  category_name_unique: "This category already exists.",
  // Product table
  product_sku_unique: "A product with this SKU already exists.",
  // Stock table
  "stock_location_id_productId_unique": "Stock record already exists for this product at this location.",
  // Purchase order
  purchase_order_po_number_tenant_unique: "A purchase order with this number already exists.",
}

interface PgError {
  code: string
  constraint_name?: string
  table_name?: string
  detail?: string
}

/**
 * Checks if a value looks like a PostgreSQL error (has a 5-char error code).
 */
function isPgError(error: unknown): error is Error & PgError {
  return (
    error instanceof Error &&
    typeof (error as any).code === "string" &&
    (error as any).code.length === 5
  )
}

/**
 * Extracts the underlying PostgreSQL error from either:
 * - A direct PostgresError (from postgres.js)
 * - A DrizzleQueryError that wraps the PostgresError in .cause
 */
function extractPgError(error: unknown): (Error & PgError) | null {
  if (isPgError(error)) return error
  if (error instanceof Error && isPgError((error as any).cause)) {
    return (error as any).cause
  }
  return null
}

/**
 * Converts a database error into a user-friendly TRPCError.
 *
 * Usage:
 * ```ts
 * try {
 *   await ctx.db.insert(User).values({...}).returning()
 * } catch (error) {
 *   throw handleDbError(error, {
 *     uniqueViolation: "A user with this email already exists.",
 *   })
 * }
 * ```
 */
export function handleDbError(
  error: unknown,
  overrides?: {
    uniqueViolation?: string
    foreignKeyViolation?: string
    notNullViolation?: string
    default?: string
  }
): TRPCError {
  if (error instanceof TRPCError) {
    return error
  }

  const pgError = extractPgError(error)
  if (pgError) {
    switch (pgError.code) {
      case PG_ERROR_CODES.UNIQUE_VIOLATION: {
        const constraintMsg = pgError.constraint_name
          ? CONSTRAINT_MESSAGES[pgError.constraint_name]
          : undefined
        return new TRPCError({
          code: "CONFLICT",
          message: overrides?.uniqueViolation ?? constraintMsg ?? "This record already exists.",
          cause: error,
        })
      }
      case PG_ERROR_CODES.FOREIGN_KEY_VIOLATION:
        return new TRPCError({
          code: "BAD_REQUEST",
          message: overrides?.foreignKeyViolation ?? "This operation references a record that does not exist.",
          cause: error,
        })
      case PG_ERROR_CODES.NOT_NULL_VIOLATION:
        return new TRPCError({
          code: "BAD_REQUEST",
          message: overrides?.notNullViolation ?? "A required field is missing.",
          cause: error,
        })
      case PG_ERROR_CODES.CHECK_VIOLATION:
        return new TRPCError({
          code: "BAD_REQUEST",
          message: "The provided value is not valid.",
          cause: error,
        })
    }
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: overrides?.default ?? "An unexpected error occurred. Please try again.",
    cause: error,
  })
}
