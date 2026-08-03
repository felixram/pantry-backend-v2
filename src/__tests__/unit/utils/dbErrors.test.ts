import { describe, it, expect } from "vitest"
import { TRPCError } from "@trpc/server"
import { handleDbError } from "../../../utils/dbErrors.ts"

/** Helper to create a mock PostgresError with the correct shape */
function createPgError(
  code: string,
  opts?: { constraint_name?: string; table_name?: string; detail?: string }
) {
  const error = new Error("some pg error")
  ;(error as any).code = code
  if (opts?.constraint_name) (error as any).constraint_name = opts.constraint_name
  if (opts?.table_name) (error as any).table_name = opts.table_name
  if (opts?.detail) (error as any).detail = opts.detail
  return error
}

/** Helper to create a mock DrizzleQueryError that wraps a PostgresError in .cause */
function createDrizzleWrappedError(
  code: string,
  opts?: { constraint_name?: string; table_name?: string; detail?: string }
) {
  const pgError = createPgError(code, opts)
  const drizzleError = new Error("Failed query: insert into ...\nparams: $1,$2,$3")
  ;(drizzleError as any).cause = pgError
  return drizzleError
}

describe("handleDbError", () => {
  describe("unique violation (23505)", () => {
    it("should return CONFLICT with override message when provided", () => {
      const error = createPgError("23505", { constraint_name: "user_email_unique_active" })
      const result = handleDbError(error, { uniqueViolation: "Custom message" })

      expect(result).toBeInstanceOf(TRPCError)
      expect(result.code).toBe("CONFLICT")
      expect(result.message).toBe("Custom message")
    })

    it("should use constraint-mapped message when no override", () => {
      const error = createPgError("23505", { constraint_name: "user_email_unique_active" })
      const result = handleDbError(error)

      expect(result.code).toBe("CONFLICT")
      expect(result.message).toBe("A user with this email address already exists.")
    })

    it("should use generic unique message for unknown constraint", () => {
      const error = createPgError("23505", { constraint_name: "some_unknown_constraint" })
      const result = handleDbError(error)

      expect(result.code).toBe("CONFLICT")
      expect(result.message).toBe("This record already exists.")
    })

    it("should use generic unique message when no constraint name", () => {
      const error = createPgError("23505")
      const result = handleDbError(error)

      expect(result.code).toBe("CONFLICT")
      expect(result.message).toBe("This record already exists.")
    })
  })

  describe("foreign key violation (23503)", () => {
    it("should return BAD_REQUEST with default message", () => {
      const error = createPgError("23503")
      const result = handleDbError(error)

      expect(result.code).toBe("BAD_REQUEST")
      expect(result.message).toBe("This operation references a record that does not exist.")
    })

    it("should use override message when provided", () => {
      const error = createPgError("23503")
      const result = handleDbError(error, { foreignKeyViolation: "Invalid reference" })

      expect(result.code).toBe("BAD_REQUEST")
      expect(result.message).toBe("Invalid reference")
    })
  })

  describe("not null violation (23502)", () => {
    it("should return BAD_REQUEST with default message", () => {
      const error = createPgError("23502")
      const result = handleDbError(error)

      expect(result.code).toBe("BAD_REQUEST")
      expect(result.message).toBe("A required field is missing.")
    })
  })

  describe("check violation (23514)", () => {
    it("should return BAD_REQUEST", () => {
      const error = createPgError("23514")
      const result = handleDbError(error)

      expect(result.code).toBe("BAD_REQUEST")
      expect(result.message).toBe("The provided value is not valid.")
    })
  })

  describe("TRPCError passthrough", () => {
    it("should return the same TRPCError without wrapping", () => {
      const trpcError = new TRPCError({ code: "NOT_FOUND", message: "Product not found" })
      const result = handleDbError(trpcError)

      expect(result).toBe(trpcError)
      expect(result.code).toBe("NOT_FOUND")
      expect(result.message).toBe("Product not found")
    })
  })

  describe("generic errors", () => {
    it("should return INTERNAL_SERVER_ERROR with safe message", () => {
      const error = new Error("some unexpected failure with sensitive data")
      const result = handleDbError(error)

      expect(result.code).toBe("INTERNAL_SERVER_ERROR")
      expect(result.message).toBe("An unexpected error occurred. Please try again.")
      expect(result.message).not.toContain("sensitive")
    })

    it("should use default override when provided", () => {
      const error = new Error("random error")
      const result = handleDbError(error, { default: "Something went wrong creating the user." })

      expect(result.code).toBe("INTERNAL_SERVER_ERROR")
      expect(result.message).toBe("Something went wrong creating the user.")
    })
  })

  describe("DrizzleQueryError wrapping (cause chain)", () => {
    it("should extract PG error from DrizzleQueryError cause", () => {
      const error = createDrizzleWrappedError("23505", { constraint_name: "user_email_unique_active" })
      const result = handleDbError(error)

      expect(result.code).toBe("CONFLICT")
      expect(result.message).toBe("A user with this email address already exists.")
    })

    it("should use override message with DrizzleQueryError", () => {
      const error = createDrizzleWrappedError("23505", { constraint_name: "user_email_unique_active" })
      const result = handleDbError(error, { uniqueViolation: "Email taken" })

      expect(result.code).toBe("CONFLICT")
      expect(result.message).toBe("Email taken")
    })

    it("should handle FK violation from DrizzleQueryError", () => {
      const error = createDrizzleWrappedError("23503")
      const result = handleDbError(error)

      expect(result.code).toBe("BAD_REQUEST")
      expect(result.message).toBe("This operation references a record that does not exist.")
    })
  })

  describe("known constraint names", () => {
    const constraintTests = [
      { constraint: "user_email_unique", expected: "A user with this email address already exists." },
      { constraint: "user_email_unique_active", expected: "A user with this email address already exists." },
      { constraint: "user_invitation_token_unique", expected: "This invitation has already been used." },
      { constraint: "tenant_slug_unique", expected: "An organization with this name already exists." },
      { constraint: "category_name_unique", expected: "This category already exists." },
      { constraint: "product_sku_unique", expected: "A product with this SKU already exists." },
      { constraint: "stock_location_id_productId_unique", expected: "Stock record already exists for this product at this location." },
    ]

    constraintTests.forEach(({ constraint, expected }) => {
      it(`should map ${constraint} to friendly message`, () => {
        const error = createPgError("23505", { constraint_name: constraint })
        const result = handleDbError(error)

        expect(result.code).toBe("CONFLICT")
        expect(result.message).toBe(expected)
      })
    })
  })
})
