import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ignoredDirectories = new Set([".git", ".cache", ".vite", "coverage", "dist", "node_modules"]);
const prohibitedNames = new Set([".DS_Store", ".env"]);
const binaryExtensions = /\.(?:avif|gif|ico|jpe?g|mp3|mp4|pdf|png|wav|webm|webp|woff2?)$/i;
const findings = new Set();

const credentialPatterns = [
  [/-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/, "private key material"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, "probable AWS access key"],
  [/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}\b/, "probable payment credential"],
  [/\brzp_(?:live|test)_[A-Za-z0-9]{8,}\b/, "probable Razorpay credential"],
  [/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}\b/, "probable GitHub credential"],
  [/\bnpm_[A-Za-z0-9]{20,}\b|_authToken\s*=\s*[^${\s][^\s]*/i, "probable npm credential"],
  [/\bxox[baprs]-[A-Za-z0-9-]{16,}\b/, "probable Slack credential"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "probable Google API credential"],
];

function add(display, reason) {
  findings.add(`${display}: ${reason}`);
}

async function walk(directory) {
  for (const name of await readdir(directory)) {
    const path = resolve(directory, name);
    const display = relative(root, path);

    if (ignoredDirectories.has(name)) continue;

    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = await readlink(path).catch(() => "unreadable target");
      add(display, `symbolic link requires review (${target})`);
      continue;
    }

    if (info.isDirectory()) {
      if (display.endsWith("data/uploads")) add(display, "copied runtime uploads directory");
      else await walk(path);
      continue;
    }

    if (prohibitedNames.has(name) || (/^\.env\./.test(name) && name !== ".env.example")) {
      add(display, "local environment file");
    }

    if (name === "package-lock.json" || binaryExtensions.test(name)) continue;

    const content = await readFile(path, "utf8").catch(() => "");
    if (/\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\[^\\]+\\/.test(content)) {
      add(display, "absolute workstation path");
    }
    for (const [pattern, reason] of credentialPatterns) {
      if (pattern.test(content)) add(display, reason);
    }
    if (name !== ".env.example" && /\b(?:postgres(?:ql)?|mongodb(?:\+srv)?|redis):\/\/[^:\s/]+:[^@\s/]+@/i.test(content)) {
      add(display, "connection URL containing credentials");
    }
  }
}

await walk(root);
if (findings.size) {
  console.error(`Repository safety check failed:\n- ${[...findings].sort().join("\n- ")}`);
  process.exit(1);
}
console.log("Repository safety check passed.");
