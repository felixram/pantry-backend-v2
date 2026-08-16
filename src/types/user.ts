//ROLES
export const ROLES = {
  admin: "ADMIN",
  manager: "MANAGER",
  user: "USER",
} as const

export type userRoles = (typeof ROLES)[keyof typeof ROLES]

/** Returns true if the role has elevated (admin-like) capabilities */
export function hasElevatedRole(role: string): boolean {
  return role === ROLES.admin || role === ROLES.manager
}

/** Returns true if the role is scoped to a specific location */
export function isLocationScoped(role: string): boolean {
  return role === ROLES.user || role === ROLES.manager
}

//user activity

// PENDING was dropped: a local User row is no longer created until a Clerk
// org invitation is accepted (organizationMembership.created webhook), so
// there's no more "invited but not yet set up" limbo state to represent.
export const STATUS = {
  active: "ACTIVE",
  inactive: "INACTIVE",
} as const

export type userStatus = (typeof STATUS)[keyof typeof STATUS]
