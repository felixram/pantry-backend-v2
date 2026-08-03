/**
 * Route-to-Data-Fetcher Mapping for SSR
 *
 * Maps each protected route to its required data fetching function.
 * The data returned will be used to pre-populate the React Query cache
 * for instant page loads with no loading spinners.
 */
import type { ServerCaller } from "./trpcCaller.ts"
import { hasElevatedRole } from "../types/user.ts"
import type { jwtTypes } from "../types/jwtTypes.ts"

/**
 * Data fetcher function type
 * Takes a tRPC caller and user, returns data keyed by tRPC query paths
 */
type DataFetcher = (
  caller: ServerCaller,
  user: jwtTypes
) => Promise<Record<string, { input: unknown; data: unknown }>>

/**
 * Route data fetchers
 * Each route maps to a function that fetches the required data for SSR
 *
 * The returned object has keys matching tRPC query paths (e.g., "report.dashboardData")
 * with values containing the input parameters and fetched data
 */
export const routeDataFetchers: Record<string, DataFetcher> = {
  "/dashboard": async (caller, user) => {
    const isElevated = hasElevatedRole(user.role)
    const input = { includeValuation: isElevated }
    const data = await caller.report.dashboardData(input)
    return {
      "report.dashboardData": { input, data },
    }
  },

  "/products": async (caller) => {
    const input = { limit: 10, offset: 0 }
    const data = await caller.product.getAll(input)
    return {
      "product.getAll": { input, data },
    }
  },

  "/stock": async (caller) => {
    const stockInput = { limit: 10, offset: 0 }
    const locationsInput = { limit: 1000 }

    const [stock, locations] = await Promise.all([
      caller.stock.getAll(stockInput),
      caller.location.getAll(locationsInput),
    ])

    return {
      "stock.getAll": { input: stockInput, data: stock },
      "location.getAll": { input: locationsInput, data: locations },
    }
  },

  "/purchase-orders": async (caller) => {
    const input = { limit: 10, offset: 0 }
    const data = await caller.purchaseOrder.getAll(input)
    return {
      "purchaseOrder.getAll": { input, data },
    }
  },

  "/suppliers": async (caller) => {
    const input = { limit: 10, offset: 0 }
    const data = await caller.supplier.getAll(input)
    return {
      "supplier.getAll": { input, data },
    }
  },

  "/categories": async (caller) => {
    const input = { limit: 10, offset: 0 }
    const data = await caller.category.getAll(input)
    return {
      "category.getAll": { input, data },
    }
  },

  "/locations": async (caller) => {
    const input = { limit: 10, offset: 0 }
    const data = await caller.location.getAll(input)
    return {
      "location.getAll": { input, data },
    }
  },

  "/users": async (caller) => {
    const input = {}
    const data = await caller.user.getAll(input)
    return {
      "user.getAll": { input, data },
    }
  },
}

/**
 * Get data fetcher for a route
 */
export function getRouteFetcher(path: string): DataFetcher | undefined {
  // Handle exact matches
  if (routeDataFetchers[path]) {
    return routeDataFetchers[path]
  }

  // Handle dynamic routes (e.g., /products/:id)
  // For now, we don't SSR detail pages - they use client-side fetching
  return undefined
}

/**
 * List of routes that support SSR
 */
export const ssrRoutes = Object.keys(routeDataFetchers)
