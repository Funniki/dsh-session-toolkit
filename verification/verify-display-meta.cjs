/**
 * Verify the merged bundle's display metadata exactly as app-boot's
 * `readPluginMeta` reads it: exported locale resources through the profile's
 * module resolver, every language file, and the exported icon.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

const PROFILE_MANIFEST = "C:/Users/G1enn/.dsh/profiles/desktop/package.json";
const SPECIFIER = "dsh-session-toolkit";
const MISSING = new Set(["ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ENOENT", "ENOTDIR"]);
const requireFromProfile = createRequire(pathToFileURL(PROFILE_MANIFEST));

function optionalResource(sub) {
	try {
		return requireFromProfile.resolve(`${SPECIFIER}/${sub}`);
	} catch (error) {
		if (MISSING.has(String(error && error.code))) return undefined;
		throw error;
	}
}

const failures = [];
function check(label, ok, detail) {
	console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail === undefined ? "" : `  ${detail}`}`);
	if (!ok) failures.push(label);
}

const englishPath = optionalResource("locale/en.json");
check("exported ./locale/en.json resolves", englishPath !== undefined, englishPath);
const localeDir = path.dirname(englishPath);
const dictionaries = new Map();
for (const entry of fs.readdirSync(localeDir, { withFileTypes: true })) {
	if (!entry.name.endsWith(".json")) continue;
	const language = entry.name.slice(0, -5);
	const file = requireFromProfile.resolve(`${SPECIFIER}/locale/${entry.name}`);
	const meta = JSON.parse(fs.readFileSync(file, "utf8")).meta;
	check(`${entry.name} meta.title`, typeof meta?.title === "string" && meta.title.trim() !== "", meta?.title);
	check(`${entry.name} meta.description`, typeof meta?.description === "string" && meta.description.trim() !== "", meta?.description);
	dictionaries.set(language.toLowerCase(), meta);
}
check("locale files discovered", dictionaries.size === 2, [...dictionaries.keys()].join(","));

const manifestPath = optionalResource("package.json");
check("exported ./package.json resolves", manifestPath !== undefined, manifestPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const iconFile = optionalResource("icon");
check("exported ./icon resolves", iconFile !== undefined, iconFile);
if (iconFile !== undefined) {
	const mediaType = new Map([[".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"]]).get(path.extname(iconFile).toLowerCase());
	check("icon is SVG/PNG/JPEG/WebP", mediaType !== undefined, mediaType);
	const stat = fs.statSync(iconFile);
	check("icon is a regular file", stat.isFile(), `${stat.size} bytes`);
	check("icon <= 256 KiB", stat.size <= 256 * 1024, `${stat.size} bytes`);
	check("icon lives inside its owning package", path.resolve(iconFile).startsWith(path.resolve(path.dirname(manifestPath)) + path.sep), path.dirname(manifestPath));
	const xml = fs.readFileSync(iconFile, "utf8");
	check("icon is a 36x36 DSH plugin-art SVG", xml.includes('viewBox="0 0 36 36"') && xml.includes("<svg"), "viewBox 0 0 36 36");
	check("icon uses no raster embed", !xml.includes("<image") && !xml.includes("base64,"), "vector only");
}

/** Replicate app-boot `localizedText`: an English fallback plus one entry per language file. */
function localizedText(field, fallback, finalFallback) {
	const entries = [...dictionaries].flatMap(([language, fields]) => {
		const value = fields?.[field];
		return value === undefined ? [] : [[language, value]];
	});
	if (entries.length === 0) return fallback ?? finalFallback;
	return { en: fallback ?? finalFallback, ...Object.fromEntries(entries) };
}

console.log("\n=== metadata the Plugins page will receive ===");
console.log(JSON.stringify({
	version: manifest.version,
	title: localizedText("title", manifest.name, SPECIFIER),
	description: localizedText("description", manifest.description, ""),
	icon: iconFile === undefined ? undefined : "<data URL omitted>"
}, null, 2));
console.log(`\nresult: ${failures.length === 0 ? "all checks passed" : `${failures.length} failed: ${failures.join(", ")}`}`);
process.exitCode = failures.length === 0 ? 0 : 1;
