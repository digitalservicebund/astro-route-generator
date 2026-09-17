import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  escapeStringLiteral,
  generateRoutes,
  getParentRouteKey,
  serializeDownloadsModule,
  serializeRoutesModule,
  toDownloadKey,
  toExportName,
  toRouteKey,
} from "./routeGenerator";

vi.mock("node:fs");

// =============================================================================
// Test Harness
// =============================================================================
// These helpers keep the integration tests compact:
// - `mockPages()` / `mockPagesAndDownloads()` simulate directory trees in memory.
// - `runBuild()` drives the Astro hooks the integration registers.

const PAGES_DIR = "src/pages";
const OUTPUT_FILE = "src/routes.ts";
const PAGES_ROOT = path.resolve(PAGES_DIR);

const DOWNLOADS_DIR = "public/downloads";
const DOWNLOADS_OUTPUT = "src/config/downloads.ts";
const DOWNLOADS_ROOT = path.resolve(DOWNLOADS_DIR);
const PUBLIC_ROOT = path.resolve("public");

type MockFile = {
  path: string;
  frontmatter?: string;
  content?: string;
};

type MockPageFile = MockFile & {
  frontmatter: string;
};

function createDirent(name: string, isDirectory: boolean) {
  return {
    name,
    isDirectory: () => isDirectory,
  };
}

function createPageWithFrontmatter(frontmatter: string) {
  return `---
${frontmatter}
---`;
}

function hasFrontmatter(file: MockFile): file is MockPageFile {
  return file.frontmatter !== undefined;
}

function fileContent(file: MockFile): string {
  return hasFrontmatter(file)
    ? createPageWithFrontmatter(file.frontmatter)
    : (file.content ?? "");
}

// Mocks fs.readdirSync/readFileSync/existsSync across one or more virtual
// directory trees, each rooted at an absolute path.
function mockFileTrees(trees: { root: string; files: MockFile[] }[]) {
  const contents = new Map(
    trees.flatMap(({ root, files }) =>
      files.map((file) => [path.join(root, file.path), fileContent(file)]),
    ),
  );

  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readdirSync).mockImplementation((dir) => {
    const dirStr = String(dir);
    const tree = trees.find(
      ({ root }) => dirStr === root || dirStr.startsWith(root + path.sep),
    );
    if (!tree) return [] as unknown as ReturnType<typeof fs.readdirSync>;

    const normalizedDir = path
      .relative(tree.root, dirStr)
      .replaceAll("\\", "/");
    const prefix = normalizedDir ? `${normalizedDir}/` : "";
    const children = new Map<string, boolean>();

    for (const file of tree.files) {
      if (!file.path.startsWith(prefix)) continue;

      const remainder = file.path.slice(prefix.length);
      const [segment, ...rest] = remainder.split("/");
      children.set(segment, rest.length > 0);
    }

    return [...children.entries()].map(([name, isDirectory]) =>
      createDirent(name, isDirectory),
    ) as unknown as ReturnType<typeof fs.readdirSync>;
  });
  vi.mocked(fs.readFileSync).mockImplementation((file) => {
    const content = contents.get(String(file));
    if (content === undefined) {
      throw new Error(`Unexpected read for ${String(file)}`);
    }

    return content;
  });
}

function mockPages(files: MockFile[]) {
  mockFileTrees([{ root: PAGES_ROOT, files }]);
}

function mockPagesAndDownloads(
  pageFiles: MockFile[],
  downloadFiles: MockFile[],
) {
  mockFileTrees([
    { root: PAGES_ROOT, files: pageFiles },
    { root: DOWNLOADS_ROOT, files: downloadFiles },
  ]);
}

function createIntegration() {
  return generateRoutes({ pagesDir: PAGES_DIR, output: OUTPUT_FILE });
}

function createIntegrationWithDownloads() {
  return generateRoutes({
    pagesDir: PAGES_DIR,
    output: OUTPUT_FILE,
    downloadsDir: DOWNLOADS_DIR,
    downloadsOutput: DOWNLOADS_OUTPUT,
  });
}

function runBuild(base = "/", publicDir = PUBLIC_ROOT) {
  const integration = createIntegration();
  const hookArg = {
    config: { base, publicDir: pathToFileURL(publicDir) },
  } as never;
  integration.hooks["astro:config:done"]?.(hookArg);
  integration.hooks["astro:build:start"]?.(hookArg);
}

function runDownloadsBuild(base = "/", publicDir = PUBLIC_ROOT) {
  const integration = createIntegrationWithDownloads();
  const hookArg = {
    config: { base, publicDir: pathToFileURL(publicDir) },
  } as never;
  integration.hooks["astro:config:done"]?.(hookArg);
  integration.hooks["astro:build:start"]?.(hookArg);
}

function getWrittenOutput() {
  return vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1] as string;
}

function getWrittenOutputFor(outputFile: string) {
  const call = vi
    .mocked(fs.writeFileSync)
    .mock.calls.find(([file]) => file === path.resolve(outputFile));
  return call?.[1] as string | undefined;
}

// =============================================================================
// Integration Tests: Route Generation Hook
// =============================================================================
// These tests exercise the full generation flow from mocked page files to the
// written routes module.

describe("generateRoutes() Integration Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Astro hook wiring
  // ---------------------------------------------------------------------------

  describe("Astro lifecycle integration", () => {
    it("triggers file generation during astro:build:start", () => {
      mockPages([
        {
          path: "index.astro",
          frontmatter: 'const frontmatter = { title: "Home" };',
        },
      ]);
      runBuild();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(OUTPUT_FILE),
        expect.stringContaining('path: "/"'),
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(OUTPUT_FILE),
        expect.stringContaining('key: "home"'),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Route graph construction
  // ---------------------------------------------------------------------------

  describe("route graph construction", () => {
    it("serializes parent references as variable names for nested routes", () => {
      mockPages([
        {
          path: "ueber/index.astro",
          frontmatter: 'const frontmatter = { title: "Über das ZfL" };',
        },
        {
          path: "ueber/daran-arbeiten-wir.astro",
          frontmatter: 'const frontmatter = { title: "Daran arbeiten wir" };',
        },
      ]);
      runBuild();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(OUTPUT_FILE),
        expect.stringContaining("parent: ueber,"),
      );
    });

    it("throws when a nested route has no generated parent route", () => {
      mockPages([
        {
          path: "ueber/index.astro",
        },
        {
          path: "ueber/daran-arbeiten-wir.astro",
          frontmatter: 'const frontmatter = { title: "Daran arbeiten wir" };',
        },
      ]);

      expect(() => runBuild()).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // File discovery and metadata filtering
  // ---------------------------------------------------------------------------

  describe("file discovery and metadata filtering", () => {
    it("ignores unsupported file extensions", () => {
      mockPages([
        {
          path: "index.astro",
          frontmatter: 'const frontmatter = { title: "Home" };',
        },
        {
          path: "notes.mdx",
          frontmatter: "title: Notes",
        },
        { path: "draft.ts" },
        { path: "image.png" },
      ]);
      runBuild();

      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
      expect(getWrittenOutput()).toContain('title: "Notes"');
      expect(getWrittenOutput()).not.toContain("draft");
      expect(getWrittenOutput()).not.toContain("image");
    });

    it("ignores dynamic route segments (files and folders starting with '[')", () => {
      mockPages([
        {
          path: "index.astro",
          frontmatter: 'const frontmatter = { title: "Home" };',
        },
        {
          path: "[slug].astro",
          frontmatter: 'const frontmatter = { title: "Dynamic" };',
        },
        {
          path: "[id]/index.astro",
          frontmatter: 'const frontmatter = { title: "Dynamic nested" };',
        },
      ]);
      runBuild();

      expect(getWrittenOutput()).toContain('title: "Home"');
      expect(getWrittenOutput()).not.toContain("slug");
      expect(getWrittenOutput()).not.toContain("Dynamic");
    });

    it("omits pages whose metadata cannot be extracted", () => {
      mockPages([
        {
          path: "index.astro",
          frontmatter: 'const frontmatter = { title: "Home" };',
        },
        {
          path: "draft.astro",
          frontmatter: "const frontmatter = {};",
        },
      ]);
      runBuild();

      expect(getWrittenOutput()).toContain('title: "Home"');
      expect(getWrittenOutput()).not.toContain("draft");
    });
  });

  // ---------------------------------------------------------------------------
  // Output serialization
  // ---------------------------------------------------------------------------

  describe("serialized routes module output", () => {
    it("emits a Route type, top-level exports with as const, and an allRoutes array", () => {
      mockPages([
        {
          path: "index.astro",
          frontmatter: 'const frontmatter = { title: "Home" };',
        },
      ]);
      runBuild();

      const output = getWrittenOutput();
      expect(output).toContain("export type Route = {");
      expect(output).toContain("export const home = {");
      expect(output).toContain("} as const;");
      expect(output).toContain("export const allRoutes = [");
      expect(output).toContain("home,");
      expect(output).toContain("] as const;");
    });

    it("serializes nullable route metadata as null literals", () => {
      mockPages([
        {
          path: "index.astro",
          frontmatter: 'const frontmatter = { title: "Home" };',
        },
      ]);
      runBuild();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(OUTPUT_FILE),
        expect.stringContaining("parent: null,"),
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(OUTPUT_FILE),
        expect.stringContaining('key: "home"'),
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(OUTPUT_FILE),
        expect.stringContaining("navLabel: null,"),
      );
    });

    it("bakes the configured Astro base path into serialized route paths", () => {
      mockPages([
        {
          path: "index.astro",
          frontmatter: 'const frontmatter = { title: "Home" };',
        },
      ]);
      runBuild("/zfl-website/previews/test-branch");

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.resolve(OUTPUT_FILE),
        expect.stringContaining('path: "/zfl-website/previews/test-branch/"'),
      );
    });

    it("escapes quotes and backslashes in serialized strings", () => {
      mockPages([
        {
          path: "index.astro",
          frontmatter: `const frontmatter = {
  title: 'A "quoted" title \\\\ path',
  navLabel: 'Label "Q" \\\\ path',
};`,
        },
      ]);
      runBuild();

      expect(getWrittenOutput()).toContain(
        'title: "A \\"quoted\\" title \\\\ path"',
      );
      expect(getWrittenOutput()).toContain(
        'navLabel: "Label \\"Q\\" \\\\ path"',
      );
    });

    it("prefixes generated export names that are not valid JS identifiers", () => {
      mockPages([
        {
          path: "2026-news.astro",
          frontmatter: 'const frontmatter = { title: "2026 News" };',
        },
      ]);
      runBuild();

      expect(getWrittenOutput()).toContain("export const _2026News = {");
      expect(getWrittenOutput()).toContain('key: "2026News"');
    });
  });
});

// =============================================================================
// Integration Tests: Download Registry Generation Hook
// =============================================================================

describe("generateRoutes() Download Registry Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not generate a downloads registry when downloadsDir is not specified", () => {
    mockPages([
      {
        path: "index.astro",
        frontmatter: 'const frontmatter = { title: "Home" };',
      },
    ]);
    runBuild();

    expect(getWrittenOutputFor(DOWNLOADS_OUTPUT)).toBeUndefined();
  });

  it("generates a DownloadRoute for every file found in the downloads directory", () => {
    mockPagesAndDownloads([], [{ path: "Prinzipien-Poster.pdf", content: "" }]);
    runDownloadsBuild();

    const output = getWrittenOutputFor(DOWNLOADS_OUTPUT);
    expect(output).toContain(
      "export const prinzipienPoster_pdf: DownloadRoute = {",
    );
    expect(output).toContain('path: "/downloads/Prinzipien-Poster.pdf"');
  });

  it("recursively scans nested folders within the downloads directory", () => {
    mockPagesAndDownloads([], [{ path: "sub/nested-file.pdf", content: "" }]);
    runDownloadsBuild();

    const output = getWrittenOutputFor(DOWNLOADS_OUTPUT);
    expect(output).toContain(
      "export const sub_nestedFile_pdf: DownloadRoute = {",
    );
    expect(output).toContain('path: "/downloads/sub/nested-file.pdf"');
  });

  it("does not collide when files share a base name but differ by extension", () => {
    mockPagesAndDownloads(
      [],
      [
        { path: "test.json", content: "" },
        { path: "test.csv", content: "" },
      ],
    );
    runDownloadsBuild();

    const output = getWrittenOutputFor(DOWNLOADS_OUTPUT);
    expect(output).toContain("export const test_json: DownloadRoute = {");
    expect(output).toContain("export const test_csv: DownloadRoute = {");
  });

  it("bakes the configured Astro base path into serialized download paths", () => {
    mockPagesAndDownloads([], [{ path: "Prinzipien-Poster.pdf", content: "" }]);
    runDownloadsBuild("/zfl-website/previews/test-branch");

    expect(getWrittenOutputFor(DOWNLOADS_OUTPUT)).toContain(
      'path: "/zfl-website/previews/test-branch/downloads/Prinzipien-Poster.pdf"',
    );
  });

  it("throws when two files normalize to the same download key", () => {
    mockPagesAndDownloads(
      [],
      [
        { path: "Photo-Report.pdf", content: "" },
        { path: "Photo_Report.pdf", content: "" },
      ],
    );

    expect(() => runDownloadsBuild()).toThrow();
  });

  it("triggers download registry regeneration during astro:build:start", () => {
    mockPagesAndDownloads([], [{ path: "Prinzipien-Poster.pdf", content: "" }]);
    runDownloadsBuild();

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.resolve(DOWNLOADS_OUTPUT),
      expect.stringContaining("prinzipienPoster"),
    );
  });
});

// =============================================================================
// Unit Tests: Downloads Module Serialization
// =============================================================================

describe("serializeDownloadsModule", () => {
  it("sorts downloads by key before serializing", () => {
    const output = serializeDownloadsModule(
      [
        { key: "zwei", path: "/downloads/zwei.pdf" },
        { key: "eins", path: "/downloads/eins.pdf" },
      ],
      "/",
    );

    expect(output.indexOf("export const eins")).toBeLessThan(
      output.indexOf("export const zwei"),
    );
  });

  it("emits a DownloadRoute type and typed const exports", () => {
    const output = serializeDownloadsModule(
      [{ key: "prinzipienPoster", path: "/downloads/Prinzipien-Poster.pdf" }],
      "/",
    );

    expect(output).toContain("export type DownloadRoute = {");
    expect(output).toContain("readonly path: string;");
    expect(output).toContain(
      "export const prinzipienPoster: DownloadRoute = {",
    );
    expect(output).toContain('path: "/downloads/Prinzipien-Poster.pdf"');
    expect(output).toContain("} as const;");
  });

  it("prefixes invalid identifiers", () => {
    const output = serializeDownloadsModule(
      [{ key: "2026Report", path: "/downloads/2026-report.pdf" }],
      "/",
    );

    expect(output).toContain("export const _2026Report: DownloadRoute = {");
  });

  it("escapes quotes and backslashes in serialized paths", () => {
    const output = serializeDownloadsModule(
      [{ key: "quoted", path: '/downloads/A "quoted" \\ path.pdf' }],
      "/",
    );

    expect(output).toContain('path: "/downloads/A \\"quoted\\" \\\\ path.pdf"');
  });

  it("bakes the base URL into serialized download paths", () => {
    const output = serializeDownloadsModule(
      [{ key: "eins", path: "/downloads/eins.pdf" }],
      "/zfl-website/previews/test-branch",
    );

    expect(output).toContain(
      'path: "/zfl-website/previews/test-branch/downloads/eins.pdf"',
    );
  });
});

// =============================================================================
// Unit Tests: Download Key Derivation
// =============================================================================

describe("toDownloadKey", () => {
  it("converts a file name to camelCase and appends the extension", () => {
    expect(toDownloadKey("/Prinzipien-Poster.pdf")).toBe(
      "prinzipienPoster_pdf",
    );
  });

  it("joins nested folder segments with underscores", () => {
    expect(toDownloadKey("/sub/nested-file.pdf")).toBe("sub_nestedFile_pdf");
  });

  it("drops unsupported characters while keeping the extension", () => {
    expect(toDownloadKey("/2026-report.pdf")).toBe("2026Report_pdf");
  });

  it("handles files without an extension", () => {
    expect(toDownloadKey("/readme")).toBe("readme");
  });

  it("transliterates German umlauts instead of dropping them", () => {
    expect(toDownloadKey("/Checkliste-Interviewführung.docx")).toBe(
      "checklisteInterviewfuehrung_docx",
    );
  });

  it("produces distinct keys for files that only differ by extension", () => {
    expect(toDownloadKey("/test.json")).toBe("test_json");
    expect(toDownloadKey("/test.csv")).toBe("test_csv");
  });

  it("lowercases the extension", () => {
    expect(toDownloadKey("/test.JSON")).toBe("test_json");
  });
});

// =============================================================================
// Unit Tests: Routes Module Serialization
// =============================================================================

describe("serializeRoutesModule", () => {
  it("sorts routes by key before serializing", () => {
    const output = serializeRoutesModule(
      [
        {
          key: "zwei",
          path: "/zwei",
          title: "Zwei",
          parentKey: null,
          sitemap: true,
          isStagingOnly: false,
          navOrder: null,
          navLabel: null,
        },
        {
          key: "eins",
          path: "/eins",
          title: "Eins",
          parentKey: null,
          sitemap: true,
          isStagingOnly: false,
          navOrder: null,
          navLabel: null,
        },
      ],
      "/",
    );

    expect(output.indexOf("export const eins")).toBeLessThan(
      output.indexOf("export const zwei"),
    );
  });

  it("prefixes invalid identifiers and preserves escaped string content", () => {
    const output = serializeRoutesModule(
      [
        {
          key: "2026News",
          path: "/2026-news",
          title: 'A "quoted" title',
          parentKey: null,
          sitemap: true,
          isStagingOnly: false,
          navOrder: null,
          navLabel: 'Label "Q"',
        },
      ],
      "/",
    );

    expect(output).toContain("export const _2026News = {");
    expect(output).toContain('key: "2026News"');
    expect(output).toContain('title: "A \\"quoted\\" title"');
    expect(output).toContain('navLabel: "Label \\"Q\\""');
  });

  it("emits parent as a variable reference for nested routes", () => {
    const output = serializeRoutesModule(
      [
        {
          key: "ueber",
          path: "/ueber",
          title: "Über",
          parentKey: null,
          sitemap: true,
          isStagingOnly: false,
          navOrder: null,
          navLabel: null,
        },
        {
          key: "ueber_daranArbeitenWir",
          path: "/ueber/daran-arbeiten-wir",
          title: "Daran arbeiten wir",
          parentKey: "ueber",
          sitemap: true,
          isStagingOnly: false,
          navOrder: null,
          navLabel: null,
        },
      ],
      "/",
    );

    expect(output).toContain("parent: ueber,");
    expect(output).toContain("export const allRoutes = [");
    expect(output).toContain("ueber,");
    expect(output).toContain("ueber_daranArbeitenWir,");
    expect(output).toContain("] as const;");
  });
});

// =============================================================================
// Unit Tests: Route Key Derivation
// =============================================================================

describe("toRouteKey", () => {
  it("converts a single route segment to camelCase", () => {
    expect(toRouteKey("/ueber-uns")).toBe("ueberUns");
  });

  it("joins nested route segments with underscores", () => {
    expect(toRouteKey("/ueber-uns/zahlen-und-fakten")).toBe(
      "ueberUns_zahlenUndFakten",
    );
  });

  it("normalizes each nested segment independently", () => {
    expect(toRouteKey("/foo_bar/baz-qux")).toBe("fooBar_bazQux");
  });

  it("drops unsupported characters while preserving route structure", () => {
    expect(toRouteKey("/ueber-uns/2026-&-mehr")).toBe("ueberUns_2026Mehr");
  });

  it("transliterates German umlauts and ß instead of dropping them", () => {
    expect(toRouteKey("/Checkliste-Interviewführung")).toBe(
      "checklisteInterviewfuehrung",
    );
    expect(toRouteKey("/Straße")).toBe("strasse");
  });

  it("converts root to home", () => {
    expect(toRouteKey("/")).toBe("home");
  });
});

describe("getParentRouteKey", () => {
  it("returns null for top-level routes", () => {
    expect(getParentRouteKey("/ueber")).toBeNull();
  });

  it("returns the normalized parent key for nested routes", () => {
    expect(getParentRouteKey("/ueber-uns/zahlen-und-fakten")).toBe("ueberUns");
  });

  it("returns the immediate parent key for deeply nested routes", () => {
    expect(getParentRouteKey("/ueber-uns/zahlen-und-fakten/team")).toBe(
      "ueberUns_zahlenUndFakten",
    );
  });
});

// =============================================================================
// Unit Tests: Serialization Helpers
// =============================================================================

describe("toExportName", () => {
  it("leaves valid JavaScript identifiers unchanged", () => {
    expect(toExportName("ueberUns")).toBe("ueberUns");
  });

  it("prefixes identifiers that start with a digit", () => {
    expect(toExportName("2026News")).toBe("_2026News");
  });
});

describe("escapeStringLiteral", () => {
  it("serializes null as the literal null", () => {
    expect(escapeStringLiteral(null)).toBe("null");
  });

  it("escapes quotes and backslashes in strings", () => {
    expect(escapeStringLiteral('A "quoted" \\ path')).toBe(
      '"A \\"quoted\\" \\\\ path"',
    );
  });
});
