import { renderToString } from 'react-dom/server'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import React from 'react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Cache the template to avoid reading from disk on every request
let templateCache: string | null = null

interface SSRModule {
  LandingPageSSR: (props: { url: string }) => React.ReactElement
}

export async function renderLandingPage(url: string = '/'): Promise<string> {
  // Dynamically import the SSR component (built by client SSR build)
  // Use path.join to prevent TypeScript from statically analyzing the import
  const ssrModulePath = path.join(__dirname, '..', '..', 'client', 'dist-ssr', 'entry-ssr.js')
  const ssrModule = (await import(ssrModulePath)) as SSRModule
  const { LandingPageSSR } = ssrModule

  // Render the landing page to HTML string
  const appHtml = renderToString(React.createElement(LandingPageSSR, { url }))

  // Read the client HTML template (cached after first read)
  if (!templateCache) {
    const templatePath = path.join(__dirname, '../../client/dist/index.html')
    templateCache = fs.readFileSync(templatePath, 'utf-8')
  }

  // Inject the rendered HTML into the template
  const html = templateCache.replace(
    '<div id="root"></div>',
    `<div id="root">${appHtml}</div>`
  )

  return html
}
