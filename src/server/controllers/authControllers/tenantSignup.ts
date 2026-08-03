import z from "zod";
import { t } from "../../trpc.ts";
import { hashPassword } from "../../../utils/passwordUtils.ts";
import { User } from "../../../db/schema/users.ts";
import { Tenant } from "../../../db/schema/tenant.ts";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { ROLES, STATUS } from "../../../types/user.ts";
import { handleDbError } from "../../../utils/dbErrors.ts";
import { TenantInvoiceConfig } from "../../../db/schema/tenantInvoiceConfig.ts";

// Password must be at least 8 characters with uppercase, lowercase, and number
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/\d/, "Password must contain at least one number");

/**
 * Public tenant signup procedure
 * Creates a new organization (tenant) and the first admin user
 * This replaces the old user self-registration
 */
export const tenantSignupProcedure = t.procedure
  .input(
    z.object({
      companyName: z
        .string()
        .min(2, "Company name must be at least 2 characters"),
      adminName: z.string().min(1, "First name is required"),
      adminLastName: z.string().min(1, "Last name is required"),
      adminEmail: z.string().email("Invalid email format"),
      password: passwordSchema,
    }),
  )
  .mutation(async ({ input, ctx }) => {
    return {
      status: "success",
      message: "Sign ups not available at this moment. please, try later",
    };

    // Generate slug from company name
    const baseSlug = input.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // Check for existing tenant with same slug
    const [existingTenant] = await ctx.db
      .select()
      .from(Tenant)
      .where(and(eq(Tenant.slug, baseSlug), isNull(Tenant.deletedAt)));

    if (existingTenant) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "An organization with this name already exists. Please choose a different name.",
      });
    }

    // Check for existing user with same email (across all tenants)
    const [existingUser] = await ctx.db
      .select()
      .from(User)
      .where(and(eq(User.email, input.adminEmail), isNull(User.deletedAt)));

    if (existingUser) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "An account with this email already exists.",
      });
    }

    // Create tenant and admin user in a transaction
    try {
      return await ctx.db.transaction(async (tx) => {
        // Create tenant
        const [tenant] = await tx
          .insert(Tenant)
          .values({
            name: input.companyName,
            slug: baseSlug,
            plan: "FREE",
          })
          .returning();

        if (!tenant) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create organization",
          });
        }

        // Hash password
        const passwordHash = await hashPassword(input.password);

        // Create admin user
        const [admin] = await tx
          .insert(User)
          .values({
            name: input.adminName,
            last_name: input.adminLastName,
            email: input.adminEmail,
            password: passwordHash,
            role: ROLES.admin,
            status: STATUS.active,
            tenant_id: tenant.id,
            location_id: null, // Admins don't have a location
          })
          .returning();

        if (!admin) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create admin user",
          });
        }

        // Create invoice config with inbound email address
        await tx.insert(TenantInvoiceConfig).values({
          tenant_id: tenant.id,
          inbound_email_address: `${baseSlug}@invoices.govantory.com`,
        });

        return {
          status: "success",
          message: "Organization created successfully. You can now sign in.",
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
        };
      });
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw handleDbError(error, {
        uniqueViolation:
          "An organization or account with these details already exists.",
      });
    }
  });
