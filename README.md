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
      pagesDir: "src/pages", // directory to scan for page files
      output: "src/config/routes.ts", // where to write the generated module (default)
      downloadsDir: "public/downloads", // optional: directory to scan for downloadable files
      downloadsOutput: "src/config/downloads.ts", // where to write the generated downloads module (default)
    }),
  ],
});
```

Then use the generated routes in your components:

```ts
import { home, ueber, ueber_daranArbeitenWir } from "@/config/routes";

home.path; // "/"
ueber.path; // "/ueber"
ueber.parent; // null
ueber_daranArbeitenWir.parent; // ueber
```

An `allRoutes` array is also exported for iterating over the full registry.

## Downloads registry

If `downloadsDir` is set, the integration also recursively scans that directory
and writes a `DownloadRoute` registry with one export per file:

```ts
import { prinzipienPoster_pdf } from "@/config/downloads";

prinzipienPoster_pdf.path; // "/downloads/Prinzipien-Poster.pdf"
```

The export key is derived the same way as route keys — from the file's path
relative to `downloadsDir`, camelCased, with nested folders joined by `_` —
plus the file's extension appended as a lowercase `_`-suffix (e.g.
`sub/nested-file.pdf` → `sub_nestedFile_pdf`), so files that share a base name
but differ only by extension (e.g. `test.json` and `test.csv`) don't collide.
The served `path` is resolved relative to Astro's `publicDir`, so it includes
any folder segments between `publicDir` and `downloadsDir` (e.g. `downloads/`
above). Generation throws if two files still normalize to the same key.

## Page metadata

Routes are picked up from frontmatter. Supported fields:

| Field           | Type      | Default  | Description                                            |
| --------------- | --------- | -------- | ------------------------------------------------------ |
| `title`         | `string`  | required | Page title. Pages without a title are skipped.         |
| `sitemap`       | `boolean` | `true`   | Include the page in the sitemap.                       |
| `isStagingOnly` | `boolean` | `false`  | Hide the route in production builds.                   |
| `navOrder`      | `number`  | `null`   | Position in navigation menus.                          |
| `navLabel`      | `string`  | `null`   | Override the navigation label (falls back to `title`). |

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
6. If `downloadsDir` is set, recursively scans it and writes a `DownloadRoute` module to `downloadsOutput`

The generated files should be committed to your repository. Do not edit them manually — they will be overwritten on the next build.

## Development

To develop and verify changes against a real project (e.g. `zfl-website`), link this package locally with pnpm instead of installing it from GitHub:

```sh
# in the consuming project (e.g. zfl-website)
pnpm link ../astro-route-generator
```

This symlinks the consuming project's `node_modules/astro-route-generator` to your local checkout, so edits here take effect immediately without publishing or bumping a tag.

To undo, in the consuming project:

```sh
pnpm unlink astro-route-generator
```
