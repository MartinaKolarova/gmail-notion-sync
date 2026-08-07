const crypto = require('node:crypto');

function createOAuthState() {
  return crypto.randomBytes(32).toString('hex');
}

function validateOAuthCallback(requestUrl, expectedState) {
  const url =
    requestUrl instanceof URL
      ? requestUrl
      : new URL(requestUrl, 'http://localhost:3000');

  const pathname = url.pathname || '/';
  if (pathname !== '/') {
    return { ok: false, reason: 'unexpected path' };
  }

  const state = url.searchParams.get('state');
  if (!state || state.trim() === '') {
    return { ok: false, reason: 'missing state' };
  }

  if (state !== expectedState) {
    return { ok: false, reason: 'invalid state' };
  }

  const error = url.searchParams.get('error');
  if (error) {
    return { ok: false, reason: 'oauth error' };
  }

  const code = url.searchParams.get('code');
  if (!code || code.trim() === '') {
    return { ok: false, reason: 'missing code' };
  }

  return {
    ok: true,
    code,
  };
}

module.exports = {
  createOAuthState,
  validateOAuthCallback,
};
