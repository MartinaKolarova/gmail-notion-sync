require('dotenv').config();

const fs = require('fs');
const { google } = require('googleapis');
const { Ollama } = require('ollama');
const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const ollama = new Ollama();

function getBody(payload) {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  if (payload.parts) {
    const textPart = payload.parts.find(
      (part) => part.mimeType === 'text/plain',
    );
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, 'base64').toString('utf8');
    }
    // Rekurzivně pro vnořené multipart
    for (const part of payload.parts) {
      const text = getBody(part);
      if (text) return text;
    }
  }
  return '';
}
function isRelevant(email) {
  const from = (email.from || '').toLowerCase();
  const subject = (email.subject || '').toLowerCase();

  if (from.includes('pomuzeme@jobs.cz')) {
    return true;
  }

  if (from.includes('jobs-noreply@linkedin.com')) {
    const normalized = subject.trim().replace(/^[^a-zá-ž]+/i, '');

    return normalized.startsWith('vaše žádost');
  }

  const keywords = [
    // Přihlášky
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
    // Pohovor
    'pohovor',
    'pohovoru',
    'pozvánka na pohovor',
    'rádi bychom vás pozvali',
    'we would like to invite',
    'interview',
    // Pozitivní
    'máme zájem',
    'postupujete do dalšího kola',
    'gratulujeme',
    'nabízíme vám',
    'we are pleased',
    'congratulations',
    'offer letter',
    // Zamítnutí
    'váš zájem o pozici jsme zaregistrovali',
    'unfortunately',
    'we regret',
    'nebudeme pokračovat',
    'nebyli jste vybrán',
    'ukončení řízení',
    // Obecné pracovní
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

  const bodyPreview = (email.body || '').slice(0, 500).toLowerCase();

  return keywords.some(
    (kw) => subject.includes(kw) || bodyPreview.includes(kw),
  );
}
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
  const token = JSON.parse(fs.readFileSync('token.json', 'utf8'));

  const credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));

  const { client_id, client_secret, redirect_uris } = credentials.installed;

  const auth = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0],
  );

  auth.setCredentials(token);

  const gmail = google.gmail({
    version: 'v1',
    auth,
  });

  let nextPageToken = null;
  const emails = [];

  do {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'after:2026/03/23 -from:notifications-noreply@linkedin.com -from:messages-noreply@linkedin.com -from:jobalerts-noreply@linkedin.com -from:novinky@odkarla.cz -from:no-reply@accounts.google.com -from:noreply@email.apple.com -from:noreply@novinky.sconto.cz -from:hezkyden@slevomat.cz -from:Coursera@m.learn.coursera.org -from:peckyzrohliku@rohlik.cz -from:info@newsletter.rossmann.cz  -from:jobs-listings@linkedin.com -from:decathlon.cz@email.decathlon.com -from:info@newsletter.agatinsvet.cz -from:info@e.knihydobrovsky.cz -from:no-reply@updates.sellpy.cz -from:no-reply@vinted.cz -from:arjo@amalka.info -from:kolar.dom@seznam.cz -from:info@katerinaresort.cz -from:ibmskillsbuild.emea@skillup.online -from:noreply@github.com -from:eshop@my-concept.cz -from:priznivci@svobodazvirat.cz -from:workspace-noreply@google.com -from:Azure@promomail.microsoft.com -from:info@saunia.cz -from:security@facebookmail.com -from:info@cleanwhale.cz -from:calendar-notification@google.com -from:newsletter@od.mestskadivadlaprazska.cz -from:notify@updates.notion.so -from:info@zuzanaklingrova.cz -from:ahoj@gardners-eshop.cz -from:security-noreply@linkedin.com -from:czechia@delivery-marketing.bolt.eu -from:czech@rides-promotions.bolt.eu -from:googleartsandculture-noreply@google.com -from:newsletter@absynt.sk -from:no-reply@avenga.teamtailor-mail.com -from:donio@donio.cz -from:no_reply@email.apple.com -from:shoes@littleshoes.cz -from:career-interests-noreply@linkedin.com -from:noreply@campaign.lindex.com -from:team@mail.notion.so -from:info@fitbelly.cz -from:milujemeknihy@martinus.cz -from:info@audiolibrix.com -from:no-reply@google.com -from:info@goodladies.cz -from:noreply-account-migration@google.com -from:support@ppl.cz -from:noreply-familynes@oznameni.nestle.cz -from:hello@getqr.com -from:noreply@geoguessr.com -from:account-security-noreply@accountprotection.microsoft.com -from:kontakt@mbank.cz',
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
        console.log('✅ Jobs.cz:', email.subject);
        continue;
      }
      const result = await classifyEmail(email);
      if (result.relevant) {
        relevant.push({ ...email, ...result });
        await saveToNotion({ ...email, ...result });
        console.log('✅', email.subject);
      } else {
        console.log('❌', email.subject);
      }
    } catch (e) {
      if (e.message.includes('fetch failed')) {
        console.log('🔄 Retry:', email.subject);
        try {
          const result = await classifyEmail(email);
          if (result.relevant) {
            relevant.push({ ...email, ...result });
            await saveToNotion({ ...email, ...result });
            console.log('✅', email.subject);
          }
        } catch (e2) {
          console.log('⚠️ Chyba po retry:', email.subject, e2.message);
        }
      } else {
        console.log('⚠️ Chyba:', email.subject, e.message);
      }
    }
  }
  console.log('\nRelevantních emailů:', relevant.length);
  console.log(
    relevant.map((e) => ({
      subject: e.subject,
      firma: e.firma,
      pozice: e.pozice,
      stav: e.stav,
    })),
  );
}

main().catch(console.error);
