# astro-route-generator

An Astro integration that auto-generates a typed route registry from your pages directory.

## Installation

```sh
pnpm add github:digitalservicebund/astro-route-generator
```

## Usage

Add the integration to your `astro.config.*`:

```ts
import { generateRoutes } from "astro-route-generator";

export default defineConfig({
  integrations: [
    generateRoutes({
      pagesDir: "src/pages",        // directory to scan for page files
      output: "src/config/routes.ts", // where to write the generated module (default)
    }),
  ],
});
```

Then use the generated routes in your components:

```ts
import { home, ueber, ueber_daranArbeitenWir } from "@/config/routes";

home.path           // "/"
ueber.path          // "/ueber"
ueber.parent        // null
ueber_daranArbeitenWir.parent // ueber
```

An `allRoutes` array is also exported for iterating over the full registry.

## Page metadata

Routes are picked up from frontmatter. Supported fields:

| Field          | Type      | Default  | Description                                      |
| -------------- | --------- | -------- | ------------------------------------------------ |
| `title`        | `string`  | required | Page title. Pages without a title are skipped.   |
| `sitemap`      | `boolean` | `true`   | Include the page in the sitemap.                 |
| `isStagingOnly`| `boolean` | `false`  | Hide the route in production builds.             |
| `navOrder`     | `number`  | `null`   | Position in navigation menus.                    |
| `navLabel`     | `string`  | `null`   | Override the navigation label (falls back to `title`). |

**`.astro` pages** — declare a `frontmatter` export as a plain object literal:

```astro
---
export const frontmatter = {
  title: "About",
  sitemap: true,
  navOrder: 2,
};
---
```

**`.mdx` / `.md` pages** — use standard YAML frontmatter:

```mdx
---
title: About
sitemap: true
navOrder: 2
---
```

## How it works

At build time (and during dev when files change), the integration:

1. Scans `pagesDir` for `.astro`, `.mdx`, `.md`, and `.html` files
2. Extracts metadata from each file's frontmatter
3. Derives a camelCase route key from the file path (e.g. `/ueber/daran-arbeiten-wir` → `ueber_daranArbeitenWir`)
4. Validates that every nested route has a corresponding parent route in the registry
5. Writes a fully typed, `as const` TypeScript module to `output`

The generated file should be committed to your repository. Do not edit it manually — it will be overwritten on the next build.
