import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireFromHere = createRequire(import.meta.url);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeSearchBase(value) {
  if (!value) {
    return null;
  }

  return path.basename(value) === "node_modules" ? path.dirname(value) : value;
}

function playwrightSearchBases() {
  const nodePathBases = (process.env.NODE_PATH || "")
    .split(path.delimiter)
    .map(normalizeSearchBase);

  return unique([
    normalizeSearchBase(process.env.PLAYWRIGHT_NODE_MODULES),
    ...nodePathBases,
    process.cwd(),
    moduleDir,
    path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node"),
    "/tmp/codex-playwright-diffuse",
  ]);
}

export function loadPlaywright() {
  const checked = [];

  for (const base of playwrightSearchBases()) {
    try {
      const resolved = requireFromHere.resolve("playwright", { paths: [base] });
      return requireFromHere(resolved);
    } catch {
      checked.push(base);
    }
  }

  throw new Error(
    [
      "Cannot find the Playwright package.",
      "Install it with `npm install -D playwright`, or set PLAYWRIGHT_NODE_MODULES to a node_modules directory that contains Playwright.",
      `Checked: ${checked.join(", ")}`,
    ].join("\n")
  );
}

export async function waitForStableHtml(page, options = {}) {
  const {
    timeoutMs = 10000,
    resourceTimeoutMs = 3000,
    freezeMotion = true,
  } = options;

  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
  await page.waitForLoadState("load", { timeout: Math.min(timeoutMs, 5000) }).catch(() => {});

  await page.evaluate(
    async ({ resourceTimeoutMs }) => {
      const waitForFonts = document.fonts?.ready || Promise.resolve();
      await Promise.race([waitForFonts, new Promise((resolve) => setTimeout(resolve, resourceTimeoutMs))]);

      const imagePromises = Array.from(document.images).map((image) => {
        if (image.complete) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          const done = () => resolve();
          image.addEventListener("load", done, { once: true });
          image.addEventListener("error", done, { once: true });
          setTimeout(done, resourceTimeoutMs);
        });
      });

      const videoPromises = Array.from(document.querySelectorAll("video")).map((video) => {
        if (video.readyState >= 1 || video.error) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          const done = () => resolve();
          video.addEventListener("loadedmetadata", done, { once: true });
          video.addEventListener("error", done, { once: true });
          setTimeout(done, resourceTimeoutMs);
        });
      });

      await Promise.all([...imagePromises, ...videoPromises]);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
    { resourceTimeoutMs }
  );

  if (freezeMotion) {
    await page.addStyleTag({
      content: `
        html[data-playwright-static],
        html[data-playwright-static] * {
          scroll-behavior: auto !important;
        }

        html[data-playwright-static] *,
        html[data-playwright-static] *::before,
        html[data-playwright-static] *::after {
          animation-play-state: paused !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
          caret-color: transparent !important;
        }
      `,
    });

    await page.evaluate(() => {
      document.documentElement.dataset.playwrightStatic = "true";

      for (const video of document.querySelectorAll("video")) {
        video.pause();
        video.removeAttribute("autoplay");
        video.preload = "metadata";
      }
    });

    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
}

export async function findHtmlFiles(rootDir, options = {}) {
  const {
    ignoreDirs = new Set([
      ".git",
      ".playwright-cli",
      "node_modules",
      "output",
      "diffuse-rotation-frames",
    ]),
  } = options;
  const found = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) {
          await walk(fullPath);
        }
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        found.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return found.sort((a, b) => a.localeCompare(b));
}
