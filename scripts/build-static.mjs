import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const assetBase = normalizeAssetBase(process.env.ONE_STACK_ASSET_BASE || "");

function normalizeAssetBase(value) {
  if (!value) return "";
  return value.endsWith("/") ? value : `${value}/`;
}

function withAssetBase(relativePath) {
  return assetBase ? `${assetBase}${relativePath}` : relativePath;
}

function rewriteHtml(html) {
  let output = html;

  for (const dir of ["assets", "media"]) {
    output = output.replaceAll(`"${dir}/`, `"${withAssetBase(`${dir}/`)}`);
    output = output.replaceAll(`'${dir}/`, `'${withAssetBase(`${dir}/`)}`);
    output = output.replaceAll(`url(${dir}/`, `url(${withAssetBase(`${dir}/`)}`);
    output = output.replaceAll(`url("${dir}/`, `url("${withAssetBase(`${dir}/`)}`);
    output = output.replaceAll(`url('${dir}/`, `url('${withAssetBase(`${dir}/`)}`);
  }

  return output;
}

async function copyIfExists(name) {
  const source = path.join(rootDir, name);
  const target = path.join(distDir, name);

  try {
    await fs.cp(source, target, { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });

const html = await fs.readFile(path.join(rootDir, "index.html"), "utf8");
await fs.writeFile(path.join(distDir, "index.html"), rewriteHtml(html));

await Promise.all([
  copyIfExists("assets"),
  copyIfExists("media"),
  copyIfExists(".nojekyll"),
]);
