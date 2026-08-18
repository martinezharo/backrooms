const TELEMETRY_PATH = '/api/telemetry';
const MAX_BODY_BYTES = 512;
const EVENTS = new Set([
  'game_started',
  'engaged_session',
  'level_reached',
  'death',
  'escape',
]);
const INPUT_MODES = new Set(['keyboard', 'touch']);

interface TelemetryPayload {
  event: string;
  depth: number;
  seconds: number;
  input: string;
}

class PayloadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function jsonError(message: string, status: number): Response {
  return Response.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new PayloadError('Payload too large', 413);
  }

  if (!request.body) throw new PayloadError('Missing request body', 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new PayloadError('Payload too large', 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PayloadError('Invalid JSON', 400);
  }
}

function parsePayload(value: unknown): TelemetryPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PayloadError('Invalid telemetry event', 400);
  }

  const record = value as Record<string, unknown>;
  const { event, depth, seconds, input } = record;
  if (typeof event !== 'string' || !EVENTS.has(event)) {
    throw new PayloadError('Unknown telemetry event', 400);
  }
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0 || depth > 5) {
    throw new PayloadError('Invalid depth', 400);
  }
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 86_400) {
    throw new PayloadError('Invalid play time', 400);
  }
  if (typeof input !== 'string' || !INPUT_MODES.has(input)) {
    throw new PayloadError('Invalid input mode', 400);
  }

  return { event, depth, seconds: Math.round(seconds), input };
}

function countryFor(request: Request): string {
  const rawCountry = request.cf && 'country' in request.cf ? request.cf.country : undefined;
  const country = typeof rawCountry === 'string' ? rawCountry.toUpperCase() : undefined;
  return country && /^[A-Z0-9]{2}$/.test(country) ? country : 'XX';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== TELEMETRY_PATH) return new Response(null, { status: 404 });
    if (request.method !== 'POST') {
      return new Response(null, {
        status: 405,
        headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
      });
    }

    const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') return jsonError('Expected application/json', 415);

    try {
      const payload = parsePayload(await readBoundedJson(request));
      const country = countryFor(request);

      // Schema: event, country, input mode | count, depth, elapsed seconds.
      // Country is supplied by Cloudflare at the edge; no IP or client ID is stored.
      env.GAME_ANALYTICS.writeDataPoint({
        blobs: [payload.event, country, payload.input],
        doubles: [1, payload.depth, payload.seconds],
        indexes: [`${country}:${payload.event}`],
      });

      return new Response(null, {
        status: 204,
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      if (error instanceof PayloadError) return jsonError(error.message, error.status);
      console.error(JSON.stringify({
        message: 'telemetry request failed',
        error: error instanceof Error ? error.message : String(error),
      }));
      return jsonError('Telemetry unavailable', 503);
    }
  },
} satisfies ExportedHandler<Env>;
