const test = require('node:test');
const assert = require('node:assert/strict');

const { getBody, isRelevant } = require('../email-helpers');

test('simple text/plain body is decoded and classified', () => {
  const payload = {
    body: {
      data: Buffer.from(
        'Dobrý den, zasílám přihlášku na pozici UX Designer.',
        'utf8',
      ).toString('base64'),
    },
  };

  const body = getBody(payload);
  assert.equal(body, 'Dobrý den, zasílám přihlášku na pozici UX Designer.');

  const email = {
    from: 'recruiter@example.com',
    subject: 'Přihláška na UX Designer',
    body,
  };

  assert.equal(isRelevant(email), true);
});

test('nested multipart message extracts text/plain part recursively', () => {
  const payload = {
    parts: [
      {
        mimeType: 'text/html',
        body: {
          data: Buffer.from(
            '<html><body>Negligible html</body></html>',
            'utf8',
          ).toString('base64'),
        },
      },
      {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/plain',
            body: {
              data: Buffer.from(
                'Děkujeme za váš zájem o pozici Senior Developer.',
                'utf8',
              ).toString('base64'),
            },
          },
        ],
      },
    ],
  };

  const body = getBody(payload);
  assert.equal(body, 'Děkujeme za váš zájem o pozici Senior Developer.');

  assert.equal(
    isRelevant({
      from: 'hr@example.com',
      subject: 'Výběrové řízení Senior Developer',
      body,
    }),
    true,
  );
});

test('HTML-only payload returns HTML string and can be relevant by subject/body keyword', () => {
  const html =
    '<html><body><p>We would like to invite you to an interview for the role.</p></body></html>';
  const payload = {
    body: {
      data: Buffer.from(html, 'utf8').toString('base64'),
    },
  };

  const body = getBody(payload);
  assert.equal(body, html);

  assert.equal(
    isRelevant({
      from: 'recruiter@company.test',
      subject: 'Interview invitation',
      body,
    }),
    true,
  );
});

test('Jobs.cz sender branch returns true always', () => {
  const email = {
    from: 'pomuzeme@jobs.cz',
    subject: 'Něco o pozici',
    body: 'Obecný obsah',
  };

  assert.equal(isRelevant(email), true);
});

test('Positive LinkedIn subject branch accepts Vaše žádost format', () => {
  const email = {
    from: 'jobs-noreply@linkedin.com',
    subject: 'Vaše žádost - Pozice Data Analyst',
    body: '',
  };

  assert.equal(isRelevant(email), true);
});

test('Negative LinkedIn subject branch rejects non-request subject', () => {
  const email = {
    from: 'jobs-noreply@linkedin.com',
    subject: 'Zajímavá zpráva pro vás',
    body: '',
  };

  assert.equal(isRelevant(email), false);
});

test('General work keyword text body is relevant', () => {
  const email = {
    from: 'company@example.test',
    subject: 'Career meeting',
    body: 'Chceme se bavit o kandidátské cestě a recruitment procesu.',
  };

  assert.equal(isRelevant(email), true);
});

test('Completely irrelevant message is rejected', () => {
  const email = {
    from: 'newsletter@example.test',
    subject: 'Týdenní novinky z produktů',
    body: 'Velké slevy a zajímavé nabídky',
  };

  assert.equal(isRelevant(email), false);
});

test('Empty or incomplete payload is handled safely', () => {
  assert.equal(getBody(undefined), '');
  assert.equal(getBody(null), '');
  assert.equal(getBody({}), '');

  assert.equal(
    isRelevant({
      from: '',
      subject: '',
      body: '',
    }),
    false,
  );
});
