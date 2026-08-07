const crypto = require('node:crypto');

function resolveOAuthMode(argv = [], hasToken = false) {
  const args = Array.isArray(argv) ? argv : [];
  const authorizeOnly = args.includes('--authorize-only');

  if (authorizeOnly) {
    if (hasToken) {
      return {
        mode: 'authorize-only-existing-token',
        authorizeOnly: true,
        allowOAuth: false,
        allowRuntime: false,
        shouldExit: true,
        message:
          'OAuth authorize-only režim je zamítnut, protože token.json již existuje. Přesuňte soubor ručně a spusťte režim znovu.',
      };
    }

    return {
      mode: 'authorize-only-create-token',
      authorizeOnly: true,
      allowOAuth: true,
      allowRuntime: false,
      shouldExit: true,
      message: 'OAuth authorize-only režim připraven k vytvoření tokenu.',
    };
  }

  if (hasToken) {
    return {
      mode: 'normal-token-present',
      authorizeOnly: false,
      allowOAuth: false,
      allowRuntime: true,
      shouldExit: false,
    };
  }

  return {
    mode: 'missing-token-blocked',
    authorizeOnly: false,
    allowOAuth: false,
    allowRuntime: false,
    shouldExit: true,
    message:
      'Token není k dispozici. Nejprve spusťte režim --authorize-only pro vytvoření token.json.',
  };
}

function createOAuthState() {
  return crypto.randomBytes(32).toString('hex');
}

function buildOAuthAuthorizationOptions(state) {
  return {
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    state,
  };
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
  buildOAuthAuthorizationOptions,
  validateOAuthCallback,
  resolveOAuthMode,
};
