import { describe, expect, it } from "vitest";
import { extractMeta } from "./extractRouteMeta";

describe("extractMeta", () => {
  it("reads literal route metadata from Astro frontmatter", () => {
    const meta = extractMeta(
      "src/pages/example.astro",
      `---
export const frontmatter = {
  title: "Example",
  sitemap: true,
  isStagingOnly: true,
  navOrder: 20,
  navLabel: "Navigation label",
};
---
`,
    );

    expect(meta).toEqual({
      title: "Example",
      sitemap: true,
      isStagingOnly: true,
      navOrder: 20,
      navLabel: "Navigation label",
    });
  });

  it("skips non-literal Astro frontmatter values", () => {
    const meta = extractMeta(
      "src/pages/example.astro",
      `---
const title = "Example";
export const frontmatter = {
  title: title,
};
---
`,
    );

    expect(meta).toBeNull();
  });

  it("keeps literal Astro frontmatter values when other entries are non-literal", () => {
    const meta = extractMeta(
      "src/pages/example.astro",
      `---
const title = "Example";
export const frontmatter = {
  title: "Example",
  seoTitle: title,
};
---
`,
    );

    expect(meta).toEqual({
      title: "Example",
      sitemap: true,
      isStagingOnly: false,
      navOrder: null,
      navLabel: null,
    });
  });

  it("ignores unrelated literal Astro frontmatter fields", () => {
    const meta = extractMeta(
      "src/pages/example.astro",
      `---
export const frontmatter = {
  title: "Example",
  seoTitle: "SEO Example",
};
---
`,
    );

    expect(meta).toEqual({
      title: "Example",
      sitemap: true,
      isStagingOnly: false,
      navOrder: null,
      navLabel: null,
    });
  });

  it("throws error if Astro frontmatter is not an object literal", () => {
    const badAstro = `---
const frontmatter = "not-an-object";
---`;
    expect(() => extractMeta("bad.astro", badAstro)).toThrow();
  });

  it.each(["src/pages/example.md", "src/pages/example.mdx"])(
    "reads route metadata from %s YAML frontmatter",
    (file) => {
      const meta = extractMeta(
        file,
        `---
title: Example
sitemap: false
isStagingOnly: true
navOrder: 5
navLabel: Navigation label
---
`,
      );

      expect(meta).toEqual({
        title: "Example",
        sitemap: false,
        isStagingOnly: true,
        navOrder: 5,
        navLabel: "Navigation label",
      });
    },
  );

  it.each(["src/pages/example.md", "src/pages/example.mdx"])(
    "returns null for %s with no frontmatter",
    (file) => {
      expect(extractMeta(file, "# Hello world\n")).toBeNull();
    },
  );

  it.each(["src/pages/example.md", "src/pages/example.mdx"])(
    "returns null for %s with frontmatter but no title",
    (file) => {
      expect(
        extractMeta(file, `---\nnavOrder: 1\n---\n`),
      ).toBeNull();
    },
  );
});
