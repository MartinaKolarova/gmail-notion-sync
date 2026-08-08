require('dotenv').config();

const fs = require('fs');
const { google } = require('googleapis');
const { Ollama } = require('ollama');
const { Client } = require('@notionhq/client');
const { getBody, isRelevant } = require('./email-helpers');
const {
  createOAuthState,
  buildLoopbackRedirectUri,
  buildOAuthAuthorizationOptions,
  buildOAuthTokenExchangeOptions,
  validateOAuthCallback,
  resolveOAuthMode,
} = require('./oauth-helpers');
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const ollama = new Ollama();

async function classifyEmail(email) {
  const response = await ollama.chat({
    model: 'qwen2.5:7b',
    messages: [
      {
        role: 'user',
        content: `Analyzuj tento email a urči jestli jde o email přímo související s konkrétní pracovní přihláškou.

Relevant: true POUZE pokud email:
- pochází od zaměstnavatele, HR nebo pracovního portálu A zároveň
- zmiňuje konkrétní pracovní pozici, podanou přihlášku nebo výběrové řízení
  nebo
- obsahuje informaci o stavu přihlášky či výběrového řízení (např. odeslána, přijata, zobrazena zaměstnavatelem, zařazena do výběrového řízení, zamítnuta)
  nebo
- jde o poděkování za zájem o pozici či zaslání přihlášky
  nebo
- informuje že zaměstnavatel zobrazil nebo prošel přihlášku
  nebo
- jde o průběžnou informaci o stavu výběrového řízení
  nebo
- předmět obsahuje "výběrové řízení" jako hlavní téma emailu

Relevant: false pokud jde o:
- obecný newsletter nebo reklamu (i kdyby zmiňoval práci nebo nabídky)
- LinkedIn zprávy od přátel
- cokoliv bez konkrétní pozice nebo přihlášky

Od: ${email.from}
Předmět: ${email.subject}
Obsah: ${email.body.slice(0, 500)}

Odpověz POUZE čistým JSON bez markdown:
{
  "relevant": true/false,
  "firma": "název firmy nebo null",
  "pozice": "název pozice nebo null",
"odkud": "LinkedIn/Jobs.cz/Firemní web/Jiné nebo null",
"stav": "Odesláno/Zařazeno do výběru/Další kolo/Zamítnuto/Čeká se nebo null",
  "kontakt": "kontaktní osoba nebo null",
  "informace": "důležité informace nebo null"
}`,
      },
    ],
  });

  const text = response.message.content
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();

  return JSON.parse(text);
}

async function saveToNotion(email) {
  await notion.pages.create({
    parent: { database_id: process.env.NOTION_DATABASE_ID },
    properties: {
      Pozice: {
        title: [
          {
            text: {
              content: email.pozice || email.subject || 'Neznámá pozice',
            },
          },
        ],
      },
      Firma: {
        rich_text: [{ text: { content: email.firma || '' } }],
      },
      Odkud: {
        select: { name: (email.odkud || 'Jiné').replace(/,.*$/, '').trim() },
      },
      Stav: {
        select: { name: (email.stav || 'Odesláno').replace(/,.*$/, '').trim() },
      },

      Informace: {
        rich_text: [{ text: { content: email.informace || '' } }],
      },
      Kontakt: {
        rich_text: [{ text: { content: email.kontakt || '' } }],
      },
      'Datum přihlášky': {
        date: { start: new Date(email.date).toISOString().split('T')[0] },
      },
      'Datum poslední aktivity': {
        date: { start: new Date(email.date).toISOString().split('T')[0] },
      },
    },
  });
}
async function main() {
  const mode = resolveOAuthMode(
    process.argv.slice(2),
    fs.existsSync('token.json'),
  );

  if (mode.mode === 'missing-token-blocked') {
    console.log(mode.message);
    return;
  }

  if (mode.mode === 'authorize-only-existing-token') {
    console.log(mode.message);
    return;
  }

  if (mode.mode === 'authorize-only-create-token') {
    const credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
    const { client_id, client_secret } = credentials.installed;
    const http = require('http');
    const server = http.createServer();

    await new Promise((resolve, reject) => {
      const handleStartupError = (error) => {
        server.off('listening', handleListening);
        reject(error);
      };
      const handleListening = () => {
        server.off('error', handleStartupError);
        resolve();
      };

      server.once('error', handleStartupError);
      server.once('listening', handleListening);
      server.listen(0, '127.0.0.1');
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close(() => {});
      throw new Error('OAuth loopback server address unavailable');
    }

    const redirectUri = buildLoopbackRedirectUri(address.port);
    const auth = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri,
    );
    const state = createOAuthState();

    let code;
    try {
      const { codeVerifier, codeChallenge } =
        await auth.generateCodeVerifierAsync();
      const url = auth.generateAuthUrl(
        buildOAuthAuthorizationOptions(state, codeChallenge),
      );

      console.log('Otevři tuto URL v prohlížeči:', url);

      code = await new Promise((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
          clearTimeout(timeoutId);
          server.off('request', handleRequest);
          server.off('error', handleServerError);
          if (server.listening) {
            server.close(() => {});
          }
        };

        const settle = (callback, value) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          callback(value);
        };

        const handleRequest = (req, res) => {
          try {
            const requestUrl = new URL(req.url, redirectUri);
            const validation = validateOAuthCallback(requestUrl, state);

            if (!validation.ok) {
              if (validation.reason === 'oauth error') {
                res.writeHead(400, {
                  'Content-Type': 'text/plain; charset=utf-8',
                });
                res.end('OAuth callback failed');
                settle(reject, new Error('OAuth callback failed'));
                return;
              }

              res.writeHead(400, {
                'Content-Type': 'text/plain; charset=utf-8',
              });
              res.end('Invalid OAuth callback');
              return;
            }

            res.writeHead(200, {
              'Content-Type': 'text/plain; charset=utf-8',
            });
            res.end('Hotovo! Zavři toto okno.');
            settle(resolve, validation.code);
          } catch (error) {
            settle(reject, error);
          }
        };

        const handleServerError = (error) => {
          settle(reject, error);
        };

        const timeoutId = setTimeout(
          () => settle(reject, new Error('OAuth callback timeout')),
          5 * 60 * 1000,
        );

        server.on('request', handleRequest);
        server.once('error', handleServerError);
      });

      const { tokens } = await auth.getToken(
        buildOAuthTokenExchangeOptions(code, codeVerifier),
      );
      auth.setCredentials(tokens);
      fs.writeFileSync('token.json', JSON.stringify(tokens), {
        mode: 0o600,
        flag: 'w',
      });
      fs.chmodSync('token.json', 0o600);
    } catch (error) {
      if (server.listening) {
        server.close(() => {});
      }
      throw error;
    }

    console.log('OAuth authorize-only režim dokončen. Token byl uložen.');
    return;
  }

  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - 23);
  const fromDate = daysAgo.toISOString().split('T')[0].replace(/-/g, '/');

  const credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed;
  const auth = new google.auth.OAuth2(
    client_id,
    client_secret,
    'http://localhost:3000',
  );

  auth.setCredentials(JSON.parse(fs.readFileSync('token.json', 'utf8')));

  const gmail = google.gmail({
    version: 'v1',
    auth: auth,
  });
  google.options({ auth });

  let nextPageToken = null;
  const emails = [];

  do {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${fromDate} -from:notifications-noreply@linkedin.com -from:messages-noreply@linkedin.com -from:jobalerts-noreply@linkedin.com -from:novinky@odkarla.cz -from:no-reply@accounts.google.com -from:noreply@email.apple.com -from:noreply@novinky.sconto.cz -from:hezkyden@slevomat.cz -from:Coursera@m.learn.coursera.org -from:peckyzrohliku@rohlik.cz -from:info@newsletter.rossmann.cz  -from:jobs-listings@linkedin.com -from:decathlon.cz@email.decathlon.com -from:info@newsletter.agatinsvet.cz -from:info@e.knihydobrovsky.cz -from:no-reply@updates.sellpy.cz -from:no-reply@vinted.cz -from:arjo@amalka.info -from:kolar.dom@seznam.cz -from:info@katerinaresort.cz -from:ibmskillsbuild.emea@skillup.online -from:noreply@github.com -from:eshop@my-concept.cz -from:priznivci@svobodazvirat.cz -from:workspace-noreply@google.com -from:Azure@promomail.microsoft.com -from:info@saunia.cz -from:security@facebookmail.com -from:info@cleanwhale.cz -from:calendar-notification@google.com -from:newsletter@od.mestskadivadlaprazska.cz -from:notify@updates.notion.so -from:info@zuzanaklingrova.cz -from:ahoj@gardners-eshop.cz -from:security-noreply@linkedin.com -from:czechia@delivery-marketing.bolt.eu -from:czech@rides-promotions.bolt.eu -from:googleartsandculture-noreply@google.com -from:newsletter@absynt.sk -from:no-reply@avenga.teamtailor-mail.com -from:donio@donio.cz -from:no_reply@email.apple.com -from:shoes@littleshoes.cz -from:career-interests-noreply@linkedin.com -from:noreply@campaign.lindex.com -from:team@mail.notion.so -from:info@fitbelly.cz -from:milujemeknihy@martinus.cz -from:info@audiolibrix.com -from:no-reply@google.com -from:info@goodladies.cz -from:noreply-account-migration@google.com -from:support@ppl.cz -from:noreply-familynes@oznameni.nestle.cz -from:hello@getqr.com -from:noreply@geoguessr.com -from:account-security-noreply@accountprotection.microsoft.com -from:kontakt@mbank.cz`,
      maxResults: 500,
      pageToken: nextPageToken,
    });

    if (!response.data.messages) break;

    for (const item of response.data.messages) {
      const message = await gmail.users.messages.get({
        userId: 'me',
        id: item.id,
      });

      const bodyText = getBody(message.data.payload);
      const headers = message.data.payload.headers;

      const subject = headers.find(
        (header) => header.name === 'Subject',
      )?.value;
      const from = headers.find((header) => header.name === 'From')?.value;
      const date = headers.find((header) => header.name === 'Date')?.value;

      const emailData = {
        subject,
        from,
        date,
        snippet: message.data.snippet,
        body: bodyText,
      };

      emails.push(emailData);
    }

    nextPageToken = response.data.nextPageToken;
  } while (nextPageToken);

  console.log('Počet emailů:', emails.length);

  const relevant = [];

  const filtered = emails.filter(isRelevant);
  console.log('Po filtraci klíčovými slovy:', filtered.length);

  let savedRelevant = 0;
  let classifiedNonRelevant = 0;
  let unsuccessful = 0;

  for (const email of filtered) {
    try {
      // Přeskoč Ollamu pro jobs.cz
      if (email.from?.toLowerCase().includes('pomuzeme@jobs.cz')) {
        relevant.push({ ...email });
        await saveToNotion({
          ...email,
          pozice: null,
          firma: null,
          odkud: 'Jobs.cz',
          stav: 'Odesláno',
          informace: null,
          kontakt: null,
        });
        savedRelevant += 1;
        continue;
      }
      const result = await classifyEmail(email);
      if (result.relevant) {
        relevant.push({ ...email, ...result });
        await saveToNotion({ ...email, ...result });
        savedRelevant += 1;
      } else {
        classifiedNonRelevant += 1;
      }
    } catch (e) {
      unsuccessful += 1;
      console.log('\n==============================');
      console.log('Zpracování zprávy bylo neúspěšné (bez detailů obsahu).');
      console.log('Typ chyby:', e?.name || 'UnknownError');
      if (typeof e?.code === 'string' || typeof e?.code === 'number') {
        console.log('Code:', e.code);
      }
      if (typeof e?.status === 'string' || typeof e?.status === 'number') {
        console.log('HTTP status:', e.status);
      }
      console.log('==============================\n');
    }
  }

  console.log('\nRelevantních emailů (úspěšně uloženo):', savedRelevant);
  console.log(
    'Nerelevantních emailů (úspěšně klasifikováno):',
    classifiedNonRelevant,
  );
  console.log('Skutečně neúspěšných zpracování:', unsuccessful);
}

main().catch((e) => {
  console.log('\n==============================');
  console.log('Zpracování aplikace selhalo (bez detailů obsahu).');
  console.log('Typ chyby:', e?.name || 'UnknownError');
  if (typeof e?.code === 'string' || typeof e?.code === 'number') {
    console.log('Code:', e.code);
  }
  if (typeof e?.status === 'string' || typeof e?.status === 'number') {
    console.log('HTTP status:', e.status);
  }
  console.log('==============================\n');
  process.exitCode = 1;
});
