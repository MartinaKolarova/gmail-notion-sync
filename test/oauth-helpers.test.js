const test = require('node:test');
const assert = require('node:assert/strict');

const { validateOAuthCallback, resolveOAuthMode } = require('../oauth-helpers');

test('valid OAuth callback is accepted', () => {
  const expectedState = 'expected-state-123';
  const result = validateOAuthCallback(
    `http://localhost:3000/?state=${expectedState}&code=auth-code-abc`,
    expectedState,
  );

  assert.equal(result.ok, true);
  assert.equal(result.code, 'auth-code-abc');
  assert.equal('state' in result, false);
  assert.equal('pathname' in result, false);
});

test('invalid OAuth state is rejected', () => {
  const expectedState = 'expected-state-123';
  const result = validateOAuthCallback(
    `http://localhost:3000/?state=wrong-state&code=auth-code-abc`,
    expectedState,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid state');
});

test('missing OAuth state is rejected', () => {
  const expectedState = 'expected-state-123';
  const result = validateOAuthCallback(
    'http://localhost:3000/?code=auth-code-abc',
    expectedState,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing state');
});

test('missing OAuth code is rejected', () => {
  const expectedState = 'expected-state-123';
  const result = validateOAuthCallback(
    `http://localhost:3000/?state=${expectedState}`,
    expectedState,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing code');
});

test('OAuth error query is rejected', () => {
  const expectedState = 'expected-state-123';
  const result = validateOAuthCallback(
    `http://localhost:3000/?state=${expectedState}&error=access_denied`,
    expectedState,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'oauth error');
});

test('unexpected callback path is rejected', () => {
  const expectedState = 'expected-state-123';
  const result = validateOAuthCallback(
    `http://localhost:3000/callback?state=${expectedState}&code=auth-code-abc`,
    expectedState,
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unexpected path');
});

test('normal run with existing token is allowed', () => {
  const result = resolveOAuthMode([], true);

  assert.equal(result.mode, 'normal-token-present');
  assert.equal(result.authorizeOnly, false);
  assert.equal(result.allowOAuth, false);
  assert.equal(result.allowRuntime, true);
  assert.equal(result.shouldExit, false);
});

test('missing token without authorize-only is blocked', () => {
  const result = resolveOAuthMode([], false);

  assert.equal(result.mode, 'missing-token-blocked');
  assert.equal(result.authorizeOnly, false);
  assert.equal(result.allowOAuth, false);
  assert.equal(result.allowRuntime, false);
  assert.equal(result.shouldExit, true);
  assert.equal(typeof result.message, 'string');
});

test('authorize-only with existing token is blocked and safe', () => {
  const result = resolveOAuthMode(['--authorize-only'], true);

  assert.equal(result.mode, 'authorize-only-existing-token');
  assert.equal(result.authorizeOnly, true);
  assert.equal(result.allowOAuth, false);
  assert.equal(result.allowRuntime, false);
  assert.equal(result.shouldExit, true);
  assert.equal(typeof result.message, 'string');
});

test('authorize-only without token chooses OAuth-only creation path', () => {
  const result = resolveOAuthMode(['--authorize-only'], false);

  assert.equal(result.mode, 'authorize-only-create-token');
  assert.equal(result.authorizeOnly, true);
  assert.equal(result.allowOAuth, true);
  assert.equal(result.allowRuntime, false);
  assert.equal(result.shouldExit, true);
  assert.equal(typeof result.message, 'string');
});
