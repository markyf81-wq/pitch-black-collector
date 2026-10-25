import { createHmac } from 'node:crypto';
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

const allowedOrigin = 'https://markyf81-wq.github.io';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
const keyPattern = /^me0[45]-\d{1,3}:(?:normal|holofoil|reverse-holofoil)(?:-(?:gamestop|eb-games|set-logo))?$/;

function reply(data, status = 200, origin = null) {
  return Response.json(data, { status, headers: { ...headers, ...(origin === allowedOrigin ? { 'Access-Control-Allow-Origin': origin } : {}) } });
}

function cleanRecords(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 500) throw new Error('Invalid collection');
  const records = {};
  for (const [key, record] of Object.entries(input)) {
    if (!keyPattern.test(key) || !record || typeof record !== 'object' || typeof record.owned !== 'boolean' || !Number.isSafeInteger(record.at) || record.at < 0 || record.at > Date.now() + 86_400_000 || typeof record.device !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(record.device)) throw new Error('Invalid collection');
    records[key] = { owned: record.owned, at: record.at, device: record.device };
  }
  return records;
}

function merge(a, b) {
  const merged = { ...a };
  for (const [key, record] of Object.entries(b)) {
    const prior = merged[key];
    if (!prior || record.at > prior.at || (record.at === prior.at && record.device > prior.device)) merged[key] = record;
  }
  return merged;
}

async function readCollection(pathname) {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result) return { exists: false, records: {}, etag: null };
  if (result.statusCode !== 200 || !result.stream) throw new Error('Could not read collection');
  const data = JSON.parse(await new Response(result.stream).text());
  return { exists: true, records: cleanRecords(data.records), etag: result.blob.etag };
}

export async function OPTIONS(request) {
  const origin = request.headers.get('origin');
  if (origin !== allowedOrigin) return new Response(null, { status: 403, headers });
  return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}

export async function POST(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== allowedOrigin && origin !== new URL(request.url).origin) return reply({ error: 'Origin not allowed' }, 403);
  if (!process.env.COLLECTION_PEPPER || !process.env.BLOB_STORE_ID) return reply({ error: 'Collection storage is not configured' }, 503, origin);
  if (Number(request.headers.get('content-length')) > 50_000) return reply({ error: 'Request too large' }, 413, origin);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 50_000) return reply({ error: 'Request too large' }, 413, origin);
    body = JSON.parse(raw);
  } catch { return reply({ error: 'Invalid request' }, 400, origin); }
  if (!body || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128 || !['load', 'sync'].includes(body.action)) return reply({ error: 'Use a password of 12–128 characters' }, 400, origin);
  let changes = {};
  try { if (body.action === 'sync') changes = cleanRecords(body.records); } catch { return reply({ error: 'Invalid collection' }, 400, origin); }
  const id = createHmac('sha256', process.env.COLLECTION_PEPPER).update(body.password.normalize('NFC')).digest('hex');
  const pathname = `collections/v1/${id}.json`;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await readCollection(pathname);
      if (body.action === 'load') return reply({ id, exists: current.exists, records: current.records }, 200, origin);
      const records = merge(current.records, changes);
      if (current.exists && JSON.stringify(records) === JSON.stringify(current.records)) return reply({ id, exists: true, records }, 200, origin);
      try {
        await put(pathname, JSON.stringify({ version: 1, records }), {
          access: 'private', contentType: 'application/json',
          ...(current.exists ? { allowOverwrite: true, ifMatch: current.etag } : {}),
        });
        return reply({ id, exists: true, records }, 200, origin);
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) continue;
        throw error;
      }
    }
    return reply({ error: 'Collection changed while saving. Try again.' }, 409, origin);
  } catch (error) {
    console.error('Collection storage error:', error);
    return reply({ error: 'Cloud collection unavailable. Your device copy is unchanged.' }, 503, origin);
  }
}
