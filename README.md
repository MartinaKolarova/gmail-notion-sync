# Gmail Notion Sync

A Node.js project for retrieving emails from Gmail using the Gmail API and preparing them for further processing, classification and synchronization with Notion.

## Features

* OAuth 2.0 authentication with Google
* Gmail API integration
* Email retrieval with Gmail search filters
* Extraction of:

  * Subject
  * Sender
  * Date
  * Snippet
  * Full email body (`text/plain`)
* Conversion of Gmail email data into a structured JavaScript dataset

## Current Status

Implemented:

* Gmail OAuth authentication
* Token generation and storage
* Email listing via Gmail API
* Email detail retrieval
* MIME payload parsing
* Base64 decoding of email content
* Structured email objects stored in an array

Example structure:

```javascript
{
  subject: "...",
  from: "...",
  date: "...",
  snippet: "...",
  body: "..."
}
```

## Tech Stack

* Node.js
* Gmail API
* Google OAuth 2.0
* JavaScript

## Installation

```bash
npm install
```

## Environment Variables

Create a `.env` file:

```env
GMAIL_CREDENTIALS_PATH=credentials.json
```

## Authentication

1. Create a Google Cloud project.
2. Enable Gmail API.
3. Configure OAuth Consent Screen.
4. Create OAuth Desktop Application credentials.
5. Download `credentials.json`.
6. Run the authentication script to generate `token.json`.

## Run

```bash
node index.js
```

## Roadmap

* Store emails in Notion
* Email classification using Ollama
* Job application tracking
* Duplicate detection
* Automated synchronization workflows

## Notes

The following files are intentionally excluded from version control:

```text
.env
credentials.json
token.json
node_modules/
```

These files contain local configuration, authentication credentials or generated dependencies.
