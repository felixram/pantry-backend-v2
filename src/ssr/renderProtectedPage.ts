/**
 * SSR Renderer for Protected Pages
 *
 * Renders authenticated pages with pre-loaded data embedded in HTML.
 * This eliminates loading spinners by providing data inline.
 */
import { renderToString } from "react-dom/server"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import React from "react"
import { createServerCaller } from "./trpcCaller.ts"
import { getRouteFetcher } from "./routeDataFetchers.ts"
import type { jwtTypes } from "../types/jwtTypes.ts"
import { logger } from "../utils/logger.ts"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Cache the template to avoid reading from disk on every request
let templateCache: string | null = null

interface SSRModule {
  renderProtectedApp: (props: {
    url: string
    initialData: Record<string, { input: unknown; data: unknown }>
    user: {
      id: string
      role: string
      name?: string
      email?: string
    }
  }) => React.ReactElement
}

interface SSRUser {
  id: string
  role: string
  name?: string
  email?: string
  location_id?: string | null
  isDemoTenant?: boolean
}

/**
 * Renders a protected page with SSR and pre-fetched data
 *
 * @param url - The route path (e.g., "/dashboard", "/products")
 * @param user - JWT payload of the authenticated user
 * @param additionalUserData - Additional user data to pass to client (name, email, etc.)
 * @returns Complete HTML string ready to send to client
 */
export async function renderProtectedPage(
  url: string,
  user: jwtTypes,
  additionalUserData?: Partial<SSRUser>
): Promise<string> {
  const startTime = Date.now()

  // Get the data fetcher for this route
  const fetcher = getRouteFetcher(url)
  if (!fetcher) {
    throw new Error(`No SSR data fetcher configured for route: ${url}`)
  }

  // Create server-side tRPC caller
  const caller = await createServerCaller(user)

  // Fetch data for this route
  const initialData = await fetcher(caller, user)

  // Dynamically import the SSR component (built by client SSR build)
  const ssrModulePath = path.join(
    __dirname,
    "..",
    "..",
    "client",
    "dist-ssr",
    "entry-ssr.js"
  )
  const ssrModule = (await import(ssrModulePath)) as SSRModule
  const { renderProtectedApp } = ssrModule

  // Prepare user data for client
  const clientUser: SSRUser = {
    id: user.id,
    role: user.role,
    ...additionalUserData,
  }

  // Render the app to HTML string
  const appHtml = renderToString(
    React.createElement(renderProtectedApp, {
      url,
      initialData,
      user: clientUser,
    })
  )

  // Read the client HTML template (cached after first read)
  if (!templateCache) {
    const templatePath = path.join(__dirname, "../../client/dist/index.html")
    templateCache = fs.readFileSync(templatePath, "utf-8")
  }

  // Inject the rendered HTML and data into the template
  const html = templateCache
    .replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`)
    .replace(
      "</head>",
      `<script>
        window.__SSR_DATA__ = ${JSON.stringify(initialData)};
        window.__SSR_USER__ = ${JSON.stringify(clientUser)};
      </script>
      </head>`
    )

  const duration = Date.now() - startTime
  logger.info({ url, duration, dataKeys: Object.keys(initialData) }, "SSR render complete")

  return html
}

/**
 * Check if a route supports SSR
 */
export function isSSRRoute(url: string): boolean {
  return getRouteFetcher(url) !== undefined
}
