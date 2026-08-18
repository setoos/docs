#!/usr/bin/env node
/**
 * Local API gateway for testing the docs playground.
 *
 * Agentic OS has no single public API host yet — each service listens on its own
 * port. This proxy fronts them all on one origin so the interactive runner in the
 * docs can use a single base URL (`http://localhost:8080/api/v1`) instead of
 * making you pick the right service per endpoint.
 *
 * The ROUTES table below is also the spec for the real ingress: whatever fronts
 * `dev-agentic-os-aks.setoo.work` needs to path-route exactly like this.
 *
 * Usage:
 *   node docs/scripts/dev-gateway.mjs
 *
 * Override a target port if your services run elsewhere:
 *   PLATFORM_CORE=3001 COMMS_ENGINE=3002 CAMPAIGN_ENGINE=3003 AGENT_WORKFLOW=3005 \
 *     node docs/scripts/dev-gateway.mjs
 */
import http from 'node:http';

// 8787 by default: 8080 is commonly taken by the frontend Vite dev server.
const PORT = Number(process.env.GATEWAY_PORT ?? 8787);

const TARGETS = {
  platformCore: Number(process.env.PLATFORM_CORE ?? 3001),
  commsEngine: Number(process.env.COMMS_ENGINE ?? 3002),
  campaignEngine: Number(process.env.CAMPAIGN_ENGINE ?? 3003),
  agentWorkflow: Number(process.env.AGENT_WORKFLOW ?? 3004),
};

/** First matching prefix wins, so order matters. Paths are after `/api/v1`. */
const ROUTES = [
  ['/agents', TARGETS.commsEngine],
  ['/channels', TARGETS.commsEngine],
  ['/call-logs', TARGETS.commsEngine],
  ['/sessions', TARGETS.commsEngine],
  ['/knowledge-bases', TARGETS.commsEngine],
  ['/prompts', TARGETS.commsEngine],
  ['/voices', TARGETS.commsEngine],
  ['/voice-numbers', TARGETS.commsEngine],
  ['/voice-profiles', TARGETS.commsEngine],
  ['/tools', TARGETS.commsEngine],
  ['/stt-providers', TARGETS.commsEngine],
  ['/tts-providers', TARGETS.commsEngine],
  ['/llm', TARGETS.commsEngine],

  ['/campaigns', TARGETS.campaignEngine],
  ['/contact-lists', TARGETS.campaignEngine],
  ['/whatsapp', TARGETS.campaignEngine],
  ['/sms-agent', TARGETS.campaignEngine],

  ['/workflows', TARGETS.agentWorkflow],
  ['/runs', TARGETS.agentWorkflow],
  ['/nodes', TARGETS.agentWorkflow],
  ['/templates', TARGETS.agentWorkflow],
  ['/approvals', TARGETS.agentWorkflow],

  ['/api-keys', TARGETS.platformCore],
  ['/auth', TARGETS.platformCore],
  ['/users', TARGETS.platformCore],
  ['/tenants', TARGETS.platformCore],
  ['/billing', TARGETS.platformCore],
  ['/wallet', TARGETS.platformCore],
  ['/integrations', TARGETS.platformCore],
  ['/analytics', TARGETS.platformCore],
  ['/logs', TARGETS.platformCore],
  ['/profile', TARGETS.platformCore],
];

const PREFIX = '/api/v1';

function resolveTarget(url) {
  if (!url.startsWith(PREFIX)) return null;
  const rest = url.slice(PREFIX.length) || '/';
  const match = ROUTES.find(([prefix]) => rest === prefix || rest.startsWith(`${prefix}/`) || rest.startsWith(`${prefix}?`));
  return match ? match[1] : null;
}

function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] ?? 'authorization,content-type',
  );
}

const server = http.createServer((req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const port = resolveTarget(req.url);

  if (!port) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      statusCode: 404,
      message: `No gateway route for ${req.url}`,
      hint: `Paths must start with ${PREFIX} and match a known prefix.`,
    }));
    console.log(`  ${req.method} ${req.url} -> no route (404)`);
    return;
  }

  console.log(`  ${req.method} ${req.url} -> :${port}`);

  const upstream = http.request(
    { host: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } },
    (upstreamRes) => {
      // Keep the gateway's CORS headers; drop the upstream's to avoid duplicates.
      const headers = { ...upstreamRes.headers };
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase().startsWith('access-control-')) delete headers[key];
      }
      res.writeHead(upstreamRes.statusCode ?? 502, headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      statusCode: 502,
      message: `Cannot reach service on port ${port}: ${err.message}`,
      hint: 'Is that service running? Override its port with an env var — see the header of this file.',
    }));
  });

  req.pipe(upstream);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use — the gateway did not start.`);
    console.error(`Pick another one:  GATEWAY_PORT=8880 node docs/scripts/dev-gateway.mjs\n`);
  } else {
    console.error(`\nGateway failed to start: ${err.message}\n`);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`\nAgentic OS dev gateway listening on http://localhost:${PORT}${PREFIX}`);
  console.log('  routing to:');
  for (const [name, port] of Object.entries(TARGETS)) console.log(`    ${name.padEnd(16)} :${port}`);
  console.log('\nSet this as the server in the docs playground:');
  console.log(`  http://localhost:${PORT}${PREFIX}\n`);
});
