import cf from 'cloudfront';
import crypto from 'crypto';

// CloudFront Function (cloudfront-js-2.0, viewer request) on segment and init
// requests of the media distribution (ADR-0008 amendment 2026-10-20).
//
// The media token in the path is checked here: HMAC-SHA256 with the media token
// secret (from the distribution's KeyValueStore) and its expiry. A catalog
// segment is then requested by its storage path without the token, so every
// session shares one cached copy; private uploads keep the token and go to the
// origin, which does not let CloudFront cache them. Playlists never reach this
// function: the origin checks the session on each of them, so a revoked session
// stops within the token's lifetime (60 s at most).

const kvs = cf.kvs();
const FILE = /^((low|standard|high)\/)?(init\.mp4|seg_\d{5}\.m4s)$/;

function denied() {
  return {
    statusCode: 403,
    statusDescription: 'Forbidden',
    headers: { 'cache-control': { value: 'no-store' } },
  };
}

function base64url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64 + '==='.slice((b64.length + 3) % 4), 'base64').toString('utf8');
}

function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handler(event) {
  const request = event.request;
  const m = /^\/media\/v1\/([^/]+)\/(.+)$/.exec(request.uri);
  if (!m || !FILE.test(m[2])) return denied();
  const parts = m[1].split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return denied();
  let secret;
  try {
    secret = await kvs.get('media-token-secret');
  } catch (e) {
    return denied();
  }
  const mac = base64url(
    crypto
      .createHmac('sha256', secret)
      .update('media:' + parts[1])
      .digest('base64'),
  );
  if (!sameString(mac, parts[2])) return denied();
  let claims;
  try {
    claims = JSON.parse(fromBase64url(parts[1]));
  } catch (e) {
    return denied();
  }
  if (typeof claims.e !== 'number' || claims.e <= Math.floor(Date.now() / 1000)) return denied();
  if (typeof claims.k !== 'string' || !/^[A-Za-z0-9_]+\/[0-9a-f]+$/.test(claims.k)) {
    return denied();
  }
  if (claims.n === 'c') request.uri = '/media/v1/edge/' + claims.k + '/' + m[2];
  return request;
}
