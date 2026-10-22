# Agent desktop demo

Three separate web apps that talk to each other in the browser, with no server involved in the messaging:

| App | URL | Role |
|---|---|---|
| **ADTCallControl** (PWA) | http://localhost:3001 | Embeds the Five9 ADT in an iframe and sends `voice` events to CRM and `chat` events to Chat |
| **CRM** (regular web app) | http://localhost:3002 | Shows a screen pop and logs every voice event it receives |
| **Chat** (regular web app) | http://localhost:3003 | Shows chat events as messages and logs each one |

Only ADTCallControl is installable and gets its own taskbar icon. CRM and Chat have no manifest or service worker, so they run as ordinary Chrome tabs and windows under Chrome's taskbar icon.

## Run

Requires Node.js. There are no dependencies to install.

```bash
node agent-desktop-demo/server.js
```

1. Open http://localhost:3001 in Chrome or Edge. Click **Install app** to get ADTCallControl as its own taskbar app.
2. Click **Open CRM** and **Open Chat**. Each opens as a normal Chrome tab; drag a tab out if you want it in its own Chrome window. You can also just type their URLs into any Chrome tab.
3. The **CRM** and **Chat** badges in ADT turn green when those windows are connected.
4. Pick an event type, type a message and press **Send**. The target app shows it, and ADT logs **ACK** once it's delivered. Expand **Raw message** on any entry to see the exact JSON.

## How it works

```
ADTCallControl (localhost:3001) ── BroadcastChannel('agent-bus') ──┐
CRM  (localhost:3002) ⊃ hidden iframe localhost:3001/bridge.html ──┤
Chat (localhost:3003) ⊃ hidden iframe localhost:3001/bridge.html ──┘
```

- CRM and Chat each embed ADT's `bridge.html` in a hidden iframe. The bridge is on ADT's origin, so it shares a BroadcastChannel with the ADTCallControl window. The bridge and its host page talk with `postMessage`.
- Different ports are different origins but the same *site*, exactly like `crm.acme.com` and `chat.acme.com`. That's why Chrome doesn't partition the bridge's channel.
- The bridge only forwards messages addressed to its own app (`to: "crm"` or `to: "chat"`). It also stamps the sender (`from`), so one app can't impersonate another.
- `bridge.html` is served with `Content-Security-Policy: frame-ancestors` listing only CRM and Chat.
- ADT pings every 3 seconds, and each window answers, which drives the connection badges. Each received event is acknowledged back to ADT.
- No window needs to have opened another. Reloading or restarting any of the three reconnects automatically.

## Message format

```json
{
  "v": 1,
  "id": "uuid",
  "ts": "2026-10-21T21:08:18.000Z",
  "type": "event",
  "from": "adt",
  "to": "crm",
  "eventType": "voice",
  "name": "callStarted",
  "source": "five9",
  "payload": {
    "message": "Call started: Jane Doe · INBOUND · Support Inbound",
    "data": { "callData": { "interactionId": "…", "ani": "5550100", "dnis": "…", "callType": "INBOUND" } }
  }
}
```

`payload.data` is the Five9 SDK's event parameters exactly as received (`callData`, `chatData`, and so on). Test messages from the form have `source: "manual"`, `name: "manual"` and no `data`.

Other types: `ping`, `pong`, `hello`, `bye`, `ack` (with `ackOf`), and `bridge.ready` (bridge to host page only).

## Moving to real domains

Change the origins in `CONFIG` in `server.js`, e.g. `https://adt.acme.com`, `https://crm.acme.com`, `https://chat.acme.com`. All three must be on the same registrable domain for the bridge to work.

## Five9 events

ADTCallControl loads the [Five9 CRM SDK](https://app.five9.com/dev/sdk/crm/latest/doc/index.html) (`five9.crm.sdk.js`). The SDK finds the ADT iframe by itself and connects to it over `postMessage`. ADT subscribes with `Five9.CrmSdk.interactionApi().subscribe(...)` and forwards:

| Five9 event | Goes to |
|---|---|
| `callStarted`, `callAccepted`, `callRejected`, `callEnded`, `callFinished` | CRM (`eventType: "voice"`) |
| `chatOffered`, `chatAccepted`, `chatRejected`, `chatTransferred`, `chatEnded`, `chatFinished` | Chat (`eventType: "chat"`) |
| `email*` | Logged in ADT only |

To see real events, log in to the ADT inside ADTCallControl and take a call or a chat.

To test without a live interaction, run this in ADTCallControl's DevTools console. It uses the same handlers the SDK calls:

```js
ADTCallControl.five9.callStarted({ callData: { ani: '5550100', callType: 'INBOUND', contactDisplayName: 'Jane Doe' } })
ADTCallControl.five9.chatOffered({ chatData: { contactDisplayName: 'John Smith', subject: 'Order delayed' } })
```

Until the SDK connects, the ADT keeps posting `connect` handshakes to the page. ADT counts all iframe messages, and you can tick **Five9 iframe traffic** to log them.
