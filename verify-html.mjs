import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findHtmlFiles, loadPlaywright, waitForStableHtml } from "./playwright-html-utils.mjs";

const rootDir = process.cwd();

function parseArgs(argv) {
  const options = {
    files: [],
    outputDir: path.join(rootDir, "output", "playwright", "html-qa"),
    viewports: [{ width: 1920, height: 1080 }],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--output" || arg === "-o") {
      options.outputDir = path.resolve(rootDir, argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--output=")) {
      options.outputDir = path.resolve(rootDir, arg.slice("--output=".length));
      continue;
    }

    if (arg === "--viewport") {
      options.viewports.push(parseViewport(argv[index + 1]));
      index += 1;
      continue;
    }

    if (arg.startsWith("--viewport=")) {
      options.viewports.push(parseViewport(arg.slice("--viewport=".length)));
      continue;
    }

    options.files.push(path.resolve(rootDir, arg));
  }

  if (options.viewports.length > 1) {
    options.viewports.shift();
  }

  return options;
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(value || "");

  if (!match) {
    throw new Error(`Invalid viewport "${value}". Use WIDTHxHEIGHT, for example 1920x1080.`);
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function safeName(filePath, index, viewport) {
  const relative = path.relative(rootDir, filePath);
  const base = relative
    .replace(/\.html$/i, "")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return `${String(index + 1).padStart(2, "0")}-${base || "page"}-${viewport.width}x${viewport.height}.png`;
}

async function pageMetrics(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText?.trim() || "";
    const elementCount = document.body?.querySelectorAll("*").length || 0;
    const hasVisualContent = Boolean(
      document.querySelector("img, svg, video, canvas, picture, [aria-label]")
    );

    return {
      bodyTextLength: text.length,
      elementCount,
      hasVisualContent,
      isMeaningful: elementCount > 0 && (text.length > 0 || hasVisualContent),
    };
  });
}

async function verifyPage(browser, filePath, index, viewport, outputDir) {
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 1,
  });
  const consoleIssues = [];
  const failedRequests = [];
  const pageErrors = [];
  let isClosing = false;

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("requestfailed", (request) => {
    if (isClosing) return;

    const failure = request.failure();
    const errorText = failure?.errorText || "failed";

    if (request.resourceType() === "media" && errorText === "net::ERR_ABORTED") {
      return;
    }

    failedRequests.push(`${errorText}: ${request.url()}`);
  });

  const screenshotPath = path.join(outputDir, safeName(filePath, index, viewport));

  try {
    await page.goto(pathToFileURL(filePath).href, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await waitForStableHtml(page);

    const title = await page.title();
    const metrics = await pageMetrics(page);
    await page.screenshot({
      path: screenshotPath,
      fullPage: false,
      animations: "disabled",
    });

    return {
      file: path.relative(rootDir, filePath),
      viewport: `${viewport.width}x${viewport.height}`,
      title,
      screenshot: screenshotPath,
      ok:
        metrics.isMeaningful &&
        consoleIssues.length === 0 &&
        failedRequests.length === 0 &&
        pageErrors.length === 0,
      metrics,
      consoleIssues,
      failedRequests,
      pageErrors,
    };
  } finally {
    isClosing = true;
    await page.close();
  }
}

const options = parseArgs(process.argv.slice(2));
const htmlFiles = options.files.length > 0 ? options.files : await findHtmlFiles(rootDir);

if (htmlFiles.length === 0) {
  throw new Error("No HTML files found to verify.");
}

await fs.mkdir(options.outputDir, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const filePath of htmlFiles) {
    await fs.access(filePath);

    for (const viewport of options.viewports) {
      results.push(
        await verifyPage(browser, filePath, results.length, viewport, options.outputDir)
      );
    }
  }
} finally {
  await browser.close();
}

const summaryPath = path.join(options.outputDir, "summary.json");
await fs.writeFile(summaryPath, `${JSON.stringify(results, null, 2)}\n`);

for (const result of results) {
  const status = result.ok ? "PASS" : "FAIL";
  console.log(
    `${status} ${result.file} ${result.viewport} title="${result.title}" screenshot=${result.screenshot}`
  );

  for (const issue of [
    ...result.pageErrors,
    ...result.consoleIssues,
    ...result.failedRequests,
  ]) {
    console.log(`  - ${issue}`);
  }

  if (!result.metrics.isMeaningful) {
    console.log("  - Page did not render meaningful DOM or visual content.");
  }
}

console.log(`Summary: ${summaryPath}`);

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
