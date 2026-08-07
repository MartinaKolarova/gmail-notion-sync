function getBody(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    const plainText = findPlainText(payload.parts);
    if (plainText) {
      return plainText;
    }

    for (const part of payload.parts) {
      const text = getBody(part);
      if (text) return text;
    }
  }

  return '';
}

function findPlainText(parts) {
  for (const part of parts) {
    if (part?.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf8');
    }

    if (part?.parts && Array.isArray(part.parts)) {
      const nested = findPlainText(part.parts);
      if (nested) {
        return nested;
      }
    }
  }

  return '';
}

function isRelevant(email) {
  const from = (email?.from || '').toLowerCase();
  const subject = (email?.subject || '').toLowerCase();

  if (from.includes('pomuzeme@jobs.cz')) {
    return true;
  }

  if (from.includes('jobs-noreply@linkedin.com')) {
    const normalized = subject.trim().replace(/^[^a-zá-ž]+/i, '');

    return normalized.startsWith('vaše žádost');
  }

  const keywords = [
    'přihláška',
    'přihlášce',
    'přihlásil',
    'přihlásila',
    'výběrové řízení',
    'výběrového řízení',
    'váš zájem o pozici',
    'zájem pracovat',
    'děkujeme za zájem',
    'thank you for your application',
    'your application',
    'pohovor',
    'pohovoru',
    'pozvánka na pohovor',
    'rádi bychom vás pozvali',
    'we would like to invite',
    'interview',
    'máme zájem',
    'postupujete do dalšího kola',
    'gratulujeme',
    'nabízíme vám',
    'we are pleased',
    'congratulations',
    'offer letter',
    'váš zájem o pozici jsme zaregistrovali',
    'unfortunately',
    'we regret',
    'nebudeme pokračovat',
    'nebyli jste vybrán',
    'ukončení řízení',
    'pozice',
    'pozici',
    'životopis',
    ' cv ',
    'kandidát',
    'kandidátka',
    'recruitment',
    'recruiter',
    'hiring',
    'career',
    'application',
    'job offer',
  ];

  const bodyPreview = (email?.body || '').slice(0, 500).toLowerCase();

  return keywords.some(
    (kw) => subject.includes(kw) || bodyPreview.includes(kw),
  );
}

module.exports = {
  getBody,
  isRelevant,
};
