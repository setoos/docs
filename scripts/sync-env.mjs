#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const docsRoot = path.resolve(__dirname, '..');
const docsJsonPath = path.join(docsRoot, 'docs.json');
const docsEnvPath = path.join(docsRoot, '.env');
const frontendEnvPath = path.resolve(docsRoot, '../agentic-os-frontend/.env');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// 1. Check CLI argument first: `node scripts/sync-env.mjs https://my-api-url.com/api/v1`
let targetApiUrl = process.argv[2];

// 2. Check process.env
if (!targetApiUrl) {
  targetApiUrl = process.env.DOCS_API_URL || process.env.API_BASE_URL || process.env.VITE_DOCS_API_URL;
}

// 3. Check docs/.env
if (!targetApiUrl) {
  const docsEnv = parseEnvFile(docsEnvPath);
  targetApiUrl = docsEnv.DOCS_API_URL || docsEnv.API_BASE_URL || docsEnv.VITE_API_URL;
}

// 4. Check agentic-os-frontend/.env
if (!targetApiUrl) {
  const frontendEnv = parseEnvFile(frontendEnvPath);
  targetApiUrl = frontendEnv.DOCS_API_URL || frontendEnv.VITE_DOCS_API_URL || frontendEnv.VITE_API_URL;
}

// 5. Default fallback
if (!targetApiUrl) {
  targetApiUrl = 'https://dev-agentic-os-aks.setoo.work/api/v1';
}

// Normalize URL: remove trailing slash, ensure /api/v1 suffix if not already present
let normalizedUrl = targetApiUrl.replace(/\/+$/, '');
if (!normalizedUrl.endsWith('/api/v1')) {
  normalizedUrl = `${normalizedUrl}/api/v1`;
}

if (!fs.existsSync(docsJsonPath)) {
  console.error(`❌ docs.json not found at ${docsJsonPath}`);
  process.exit(1);
}

const docsJson = JSON.parse(fs.readFileSync(docsJsonPath, 'utf8'));

if (!docsJson.api) docsJson.api = {};
if (!docsJson.api.mdx) docsJson.api.mdx = {};

const previousServer = docsJson.api.baseUrl || docsJson.api.mdx?.server;
docsJson.api.baseUrl = normalizedUrl;
docsJson.api.mdx.server = normalizedUrl;

fs.writeFileSync(docsJsonPath, JSON.stringify(docsJson, null, 2) + '\n');

console.log(`✨ Synced API Base URL to docs.json:`);
console.log(`   Previous: ${JSON.stringify(previousServer)}`);
console.log(`   Updated : "${normalizedUrl}"`);
