# Apps Script Backend Update — Required for the New Member Portal Features

The member portal (`member.html`) now sends two new things to your Google Apps
Script backend:

1. **A shared secret key** (`27268cf583e78fcdb9e5eb2d5bada419`) with every
   request — GET requests carry it as `&key=...`, POST requests as `api_key`
   in the JSON body. Requests without the correct key should be rejected.
2. **A new action, `member_request`** — sent when a member taps NOTIFY ME,
   stars a title, submits a title request, leaves a review, or flags a disc
   issue. These used to go nowhere; now they expect the backend to record them.

> **Important:** until you apply this update, the new request buttons
> (NOTIFY ME, SUBMIT REQUEST, LEAVE REVIEW, FLAG ISSUE) will show
> "TRY AGAIN" / "Could not send" because the backend doesn't recognize
> `member_request` yet. Existing features (login, catalog, checkout,
> return) keep working either way — the backend ignores the extra key
> until you start checking it.

## How to apply

1. Open [script.google.com](https://script.google.com) and open the project
   that backs the member portal.
2. Make the code changes below.
3. Click **Deploy → Manage deployments**, click the pencil ✏️ on your active
   deployment, set **Version: New version**, and click **Deploy**. (The URL
   stays the same — do *not* create a brand-new deployment, that would change
   the URL.)

## 1. Add the shared secret

At the top of your script, add:

```javascript
// Must match API_KEY in member.html. To rotate it, change it in BOTH places
// and redeploy both the script (new version) and the website.
var API_KEY = '27268cf583e78fcdb9e5eb2d5bada419';

function isAuthorized(key) {
  return key === API_KEY;
}
```

## 2. Check the key in doGet and doPost

At the very top of your existing `doGet(e)`:

```javascript
function doGet(e) {
  if (!isAuthorized(e.parameter.key)) {
    return jsonOut({ ok: false, error: 'unauthorized' });
  }
  // ... your existing doGet code continues unchanged ...
}
```

At the very top of your existing `doPost(e)` (after parsing the body):

```javascript
function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  if (!isAuthorized(body.api_key)) {
    return jsonOut({ ok: false, error: 'unauthorized' });
  }
  if (body.action === 'member_request') {
    return handleMemberRequest(body);
  }
  // ... your existing doPost code continues unchanged ...
}
```

If you already have a helper that returns JSON, use it instead of `jsonOut`;
otherwise add:

```javascript
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 3. Handle member requests

This appends every request to a **Requests** sheet in your spreadsheet
(created automatically the first time). Replace `findMemberByToken` with
whatever lookup your existing actions use to validate the token.

```javascript
function handleMemberRequest(body) {
  // Validate the member token the same way your other actions do
  var member = findMemberByToken(body.token);
  if (!member) return jsonOut({ ok: false, error: 'invalid token' });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Requests');
  if (!sheet) {
    sheet = ss.insertSheet('Requests');
    sheet.appendRow(['Timestamp', 'Member ID', 'Type', 'Item ID', 'Text', 'Status']);
  }
  sheet.appendRow([
    new Date(),
    body.member_id || '',
    body.type || '',
    body.item_id || '',
    body.text || '',
    'NEW',
  ]);
  return jsonOut({ ok: true });
}
```

### Request types you'll see in the sheet

| `type`          | Sent when a member...                          |
|-----------------|------------------------------------------------|
| `notify`        | taps NOTIFY ME on an unavailable title (or stars one) |
| `star`          | stars an available title                       |
| `title_request` | submits "What would you like to see?"          |
| `review`        | taps LEAVE REVIEW in rental history            |
| `flag`          | taps FLAG ISSUE in rental history              |

## A note on what the key does (and doesn't do)

`member.html` is a public page, so anyone who views its source can read the
key. It is **not** a password — it stops bots and casual abuse of your backend
URL, but the real per-member security is the membership token, which the
backend must keep validating on every action. If the key ever leaks into spam
traffic, rotate it: generate a new random string, update it in both
`member.html` and the script, and redeploy both.
