import { TRPCError } from "@trpc/server"
import { ROLES, isLocationScoped } from "../types/user.ts"
import type { jwtTypes } from "../types/jwtTypes.ts"

/**
 * Returns location_id to filter by based on user role
 *
 * - ADMIN: Returns requestedLocationId or undefined (see all locations)
 * - USER/MANAGER: Returns userLocationId (only see their assigned location)
 * - Throws error if location-scoped user requests a different location than assigned
 *
 * @param user - JWT user object with id and role
 * @param userLocationId - User's assigned location_id from context
 * @param requestedLocationId - Optional location_id from request input
 * @returns location_id to filter by, or undefined for no filtering
 */
export function getLocationFilter(
  user: jwtTypes | null,
  userLocationId: string | null,
  requestedLocationId?: string
): string | undefined {
  // Admin users can see all locations or filter by requested location
  if (user?.role === ROLES.admin) {
    return requestedLocationId
  }

  // Location-scoped users (USER and MANAGER) can only see their assigned location
  if (user && isLocationScoped(user.role)) {
    // If they request a specific location, verify it matches their assignment
    if (requestedLocationId && requestedLocationId !== userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only access data from your assigned location",
      })
    }
    return userLocationId || undefined
  }

  return undefined
}

/**
 * Validates that a user has access to create/modify entities at a location
 *
 * - ADMIN: Always allowed (can access any location)
 * - USER/MANAGER: Only allowed if targetLocationId matches userLocationId
 *
 * @param user - JWT user object
 * @param userLocationId - User's assigned location_id
 * @param targetLocationId - Location being accessed/modified
 * @throws TRPCError if location-scoped user tries to access unauthorized location
 */
export function validateLocationAccess(
  user: jwtTypes,
  userLocationId: string | null,
  targetLocationId: string
): void {
  // Admins can access any location
  if (user.role === ROLES.admin) {
    return
  }

  // Location-scoped users (USER and MANAGER) must access their own location
  if (isLocationScoped(user.role)) {
    if (!userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "User location not assigned. Contact administrator.",
      })
    }

    // Verify they're accessing their own location
    if (targetLocationId !== userLocationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only create/modify data for your assigned location",
      })
    }
  }
}
