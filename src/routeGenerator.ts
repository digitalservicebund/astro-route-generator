import type { AstroIntegration } from "astro";
import fs, { type Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractMeta } from "./routeGeneration/extractRouteMeta";

type Options = {
  pagesDir: string;
  output?: string;
  downloadsDir?: string;
  downloadsOutput?: string;
};

export type RouteMeta = {
  title: string;
  sitemap: boolean;
  isStagingOnly: boolean;
  navOrder: number | null;
  navLabel: string | null;
};

export type Route = RouteMeta & {
  path: string;
  key: string;
  parentKey: string | null;
};

export type DownloadRoute = {
  path: string;
};

type DownloadEntry = {
  key: string;
  path: string;
};

const SUPPORTED_EXTENSIONS = ["astro", "md", "mdx", "html"];
const SUPPORTED_EXTENSIONS_REGEXP = new RegExp(
  String.raw`\.(${SUPPORTED_EXTENSIONS.join("|")})$`,
);

// Registers the route generation hook with Astro.
export function generateRoutes({
  pagesDir,
  output = "src/config/routes.ts",
  downloadsDir,
  downloadsOutput = "src/config/downloads.ts",
}: Options): AstroIntegration {
  let baseUrl = "";
  let publicDir = "";

  const generateAll = () => {
    generate(pagesDir, output, baseUrl);
    if (downloadsDir) {
      generateDownloads(downloadsDir, downloadsOutput, baseUrl, publicDir);
    }
  };

  return {
    name: "generate-routes",
    hooks: {
      "astro:config:done": ({ config }) => {
        baseUrl = config.base;
        publicDir = fileURLToPath(config.publicDir);
      },
      "astro:server:setup": ({ server }) => {
        generateAll(); // Initial generation

        // Watch for changes, additions, or deletions in the watched directories.
        server.watcher.on("all", (event, file) => {
          const isRelevantEvent = ["add", "unlink", "change"].includes(event);
          if (!isRelevantEvent) return;

          const isPageFile = file.startsWith(path.resolve(pagesDir));
          if (isPageFile && SUPPORTED_EXTENSIONS_REGEXP.test(file)) {
            console.log(`Route generation triggered for ${file}`);
            generate(pagesDir, output, baseUrl);
          }

          const isDownloadFile =
            downloadsDir && file.startsWith(path.resolve(downloadsDir));
          if (isDownloadFile) {
            console.log(`Download registry generation triggered for ${file}`);
            generateDownloads(downloadsDir, downloadsOutput, baseUrl, publicDir);
          }
        });
      },
      "astro:build:start": generateAll,
    },
  };
}

// Generates the routes module from the page files.
function generate(pagesDir: string, outputFile: string, baseUrl: string) {
  const absoluteDir = path.resolve(pagesDir);
  if (!fs.existsSync(absoluteDir)) return;

  // 1. Get all files from the pages directory
  const allFiles = getFiles(absoluteDir);

  // 2. Process the list into routes with parent keys
  const routes: Route[] = [];
  for (const file of allFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const meta = extractMeta(file, content);
    if (!meta) continue;

    const relativePath =
      file
        .replace(absoluteDir, "")
        .replace(SUPPORTED_EXTENSIONS_REGEXP, "")
        .replace(/\/index$/, "") || "/";

    routes.push({
      key: toRouteKey(relativePath),
      path: relativePath,
      parentKey: getParentRouteKey(relativePath),
      ...meta,
    });
  }

  // 3. Validate that every parent reference resolves
  for (const route of routes) {
    if (!route.parentKey) continue;
    if (!routes.some((r) => r.key === route.parentKey)) {
      throw new Error(
        `Route "${route.key}" references parent "${route.parentKey}" which does not exist in the route registry.`,
      );
    }
  }

  // 4. Serialize the routes module
  fs.writeFileSync(
    path.resolve(outputFile),
    serializeRoutesModule(routes, baseUrl),
  );
}

// Generates the downloads registry module from the files in the downloads directory.
function generateDownloads(
  downloadsDir: string,
  outputFile: string,
  baseUrl: string,
  publicDir: string,
) {
  const absoluteDir = path.resolve(downloadsDir);
  if (!fs.existsSync(absoluteDir)) return;

  // 1. Get all files from the downloads directory
  const allFiles = getAllFiles(absoluteDir);

  // 2. Process the list into download entries
  const downloads: DownloadEntry[] = allFiles.map((file) => {
    const keyRelativePath = file.replace(absoluteDir, "");
    const servedPath = `/${path.relative(publicDir, file).replaceAll("\\", "/")}`;

    return {
      key: toDownloadKey(keyRelativePath),
      path: servedPath,
    };
  });

  // 3. Validate that every download key is unique
  const seenKeys = new Set<string>();
  for (const download of downloads) {
    if (seenKeys.has(download.key)) {
      throw new Error(
        `Download key "${download.key}" is not unique — multiple files normalize to the same key.`,
      );
    }
    seenKeys.add(download.key);
  }

  // 4. Serialize the downloads module
  fs.writeFileSync(
    path.resolve(outputFile),
    serializeDownloadsModule(downloads, baseUrl),
  );
}

// Recursively retrieves all files from a directory and its subdirectories that match the supported file extensions.
function getFiles(dir: string): string[] {
  // Read directory entries (files and folders) as Dirent objects to easily check types
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry: Dirent<string>) => {
      const full = path.join(dir, entry.name);

      // ignore dynamic routes / route segments (e.g. [slug]/ or [slug].astro)
      if (entry.name.startsWith("[")) return [];

      // If the entry is a directory, recurse into it and flatten the resulting array
      if (entry.isDirectory()) {
        return getFiles(full);
      }

      // Only return the file path if it matches our allowed extensions
      // Otherwise, return an empty array (which flatMap will remove)
      const isPageFile = SUPPORTED_EXTENSIONS_REGEXP.test(entry.name);
      return isPageFile ? [full] : [];
    });
}

// Recursively retrieves every file from a directory and its subdirectories.
function getAllFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry: Dirent<string>) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? getAllFiles(full) : [full];
    });
}

const GERMAN_TRANSLITERATIONS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
};

// Transliterate German umlauts/ß to their ASCII digraphs so they survive as
// letters instead of being silently dropped by the character filter below.
function transliterateGerman(input: string): string {
  return input.replaceAll(
    /[äöüÄÖÜß]/g,
    (char) => GERMAN_TRANSLITERATIONS[char],
  );
}

export function toRouteKey(input: string): string {
  if (input === "/") return "home";

  return (
    input
      // Keep nested route boundaries visible in the generated key.
      .split("/")
      .filter(Boolean)
      .map((segment) =>
        transliterateGerman(segment)
          .replaceAll(/[^a-zA-Z0-9-_]/g, "")
          // Normalize each path segment independently before joining nested segments with `_`.
          .split(/[-_]/)
          .filter(Boolean)
          .map((part, i) =>
            i === 0
              ? part[0].toLowerCase() + part.slice(1)
              : part[0].toUpperCase() + part.slice(1),
          )
          .join(""),
      )
      .join("_")
  );
}

export function getParentRouteKey(routePath: string): string | null {
  const segments = routePath.split("/").filter(Boolean);
  return segments.length <= 1
    ? null
    : toRouteKey(segments.slice(0, -1).join("/"));
}

export function toDownloadKey(relativePath: string): string {
  return toRouteKey(relativePath.replace(/\.[^./]+$/, ""));
}

const ROUTE_TYPE = `export type Route = {
  readonly key: string;
  readonly path: string;
  readonly title: string;
  readonly parent: Route | null;
  readonly sitemap: boolean;
  readonly isStagingOnly: boolean;
  readonly navOrder: number | null;
  readonly navLabel: string | null;
};`;

export function serializeRoutesModule(routes: Route[], baseUrl: string) {
  const sortedRoutes = routes.toSorted(({ key: keyA }, { key: keyB }) =>
    keyA.localeCompare(keyB),
  );

  const exports = sortedRoutes
    .map(
      ({
        key,
        path,
        title,
        parentKey,
        sitemap,
        isStagingOnly,
        navOrder,
        navLabel,
      }) =>
        `export const ${toExportName(key)} = {
  key: ${escapeStringLiteral(key)},
  path: ${escapeStringLiteral(buildRoutePath(path, baseUrl))},
  title: ${escapeStringLiteral(title)},
  parent: ${parentKey ? toExportName(parentKey) : "null"},
  sitemap: ${sitemap},
  isStagingOnly: ${isStagingOnly},
  navOrder: ${navOrder ?? "null"},
  navLabel: ${escapeStringLiteral(navLabel)},
} as const;`,
    )
    .join("\n\n");

  const allRoutesList = sortedRoutes
    .map(({ key }) => toExportName(key))
    .join(",\n  ");

  return `// ⚠️ This file is auto-generated — do not edit manually. ⚠️

${ROUTE_TYPE}

${exports}

export const allRoutes = [
  ${allRoutesList},
] as const;
`;
}

// Ensure the key is a valid JS identifier for use as an export name.
export function toExportName(routeKey: string): string {
  return /^[A-Za-z_$]/.test(routeKey) ? routeKey : `_${routeKey}`;
}

// Serialize nullable values as JS string literals or the literal null.
export function escapeStringLiteral(input: string | null): string {
  return input === null
    ? "null"
    : `"${input.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function removeTrailingSlash(path: string): string {
  return path.replace(/\/$/, "").replace(/^$/, "/");
}

function buildRoutePath(href: string, baseUrl = ""): string {
  const normalizedBaseUrl = removeTrailingSlash(baseUrl);
  return normalizedBaseUrl === "/" ? href : `${normalizedBaseUrl}${href}`;
}

const DOWNLOAD_TYPE = `export type DownloadRoute = {
  readonly path: string;
};`;

export function serializeDownloadsModule(
  downloads: DownloadEntry[],
  baseUrl: string,
) {
  const sortedDownloads = downloads.toSorted(({ key: keyA }, { key: keyB }) =>
    keyA.localeCompare(keyB),
  );

  const exports = sortedDownloads
    .map(
      ({ key, path }) =>
        `export const ${toExportName(key)}: DownloadRoute = {
  path: ${escapeStringLiteral(buildRoutePath(path, baseUrl))},
} as const;`,
    )
    .join("\n\n");

  return `// ⚠️ This file is auto-generated — do not edit manually. ⚠️

${DOWNLOAD_TYPE}

${exports}
`;
}
