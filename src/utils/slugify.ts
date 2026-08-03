/**
 * Generate a URL-safe slug from a string.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * Generate a location-specific email slug that avoids redundant prefixes.
 *
 * Examples (tenantSlug = "akimori"):
 *   "Akimori BK"        → "akimori-bk"
 *   "Akimori"            → "akimori"
 *   "Warehouse East"     → "akimori-warehouse-east"
 *   "akimori-central"    → "akimori-central"
 */
export function generateLocationEmailSlug(
  tenantSlug: string,
  locationName: string
): string {
  const locationSlug = slugify(locationName)

  // If location slug already starts with tenant slug, don't double-prefix
  if (
    locationSlug === tenantSlug ||
    locationSlug.startsWith(tenantSlug + "-")
  ) {
    return locationSlug
  }

  return `${tenantSlug}-${locationSlug}`
}
