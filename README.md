# Agent desktop demo

Three separate web apps that talk to each other in the browser, with no server involved in the messaging:

| App | URL | Role |
|---|---|---|
| **ADTCallControl** (PWA) | http://localhost:3001 | Embeds the Five9 ADT in an iframe and sends `voice` events to CRM and `chat` events to Chat |
| **CRM** (regular web app) | http://localhost:3002 | Shows a screen pop and logs every voice event it receives |
| **Chat** (regular web app) | http://localhost:3003 | Shows chat events as messages and logs each one |

Only ADTCallControl is installable and gets its own taskbar icon. CRM and Chat have no manifest or service worker, so they run as ordinary Chrome tabs and windows under Chrome's taskbar icon.

## Get the code

You need [Node.js](https://nodejs.org/) 16 or later, and Chrome or Edge. There are no packages to install.

With Git:

```bash
git clone https://github.com/readabhishek/agent-desktop-demo.git
cd agent-desktop-demo
```

Without Git, open https://github.com/readabhishek/agent-desktop-demo, click **Code → Download ZIP**, unzip it, and open a terminal in the unzipped folder.

## Run

From the project folder:

```bash
npm start
```

(or `node server.js`). It prints the three URLs. Press **Ctrl+C** to stop it.

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



## Does a CRM freeze, refresh, crash or hang affect the ADTCallControl PWA?

**Question:** Since ADTCallControl PWA runs in a completely separate browser runtime, I want to make sure that if anything happens in the CRM app — it freezes, refreshes, crashes or hangs — it shouldn't affect the ADTCallControl PWA, right? Say the agent is on an audio call with the end customer; nothing should interrupt it when an issue happens in the CRM app?

**Answer:** Mostly yes, but one assumption needs correcting first. An installed PWA is **not** a separate browser runtime. ADTCallControl runs inside the same Chrome as CRM, in the same profile, with a separate window. What protects it is Chrome's multi-process design, which isolates pages from each other. That isolation covers most CRM problems, but not all of them.

### How Chrome splits the work

```text
One Chrome browser process (shared: windows, tabs, network, audio service, GPU)
 ├─ Renderer process: ADTCallControl page (adt.acme.com)
 │    └─ Renderer process: Five9 iframe (app.five9.com)  ← WebRTC call runs here
 └─ Renderer process: CRM tab (crm.acme.com)
```

- Each page's code runs in a renderer process. A freeze or crash in a renderer usually affects only that page.
- The Five9 iframe is on a different domain from ADT, so Chrome always gives it its own process. The WebRTC call is handled there, isolated even from ADT's own code.
- The audio itself goes through Chrome's shared audio and network services. A misbehaving web page can't normally crash those.
- **One catch:** `adt.acme.com` and `crm.acme.com` count as the same *site* to Chrome. Chrome usually gives each its own process, but it's allowed to put them in one process, especially when memory is low. If that happens, a CRM crash or hang takes ADT's page down with it.

### What happens to an active call

| What happens in CRM | Effect on ADT and the call | Notes |
|---|---|---|
| Refresh | ✅ None | The CRM badge goes grey, then green again in a few seconds |
| JavaScript hang or freeze | ✅ None, if ADT has its own process | ADT never waits for CRM: messages are sent without waiting, and a missing reply only shows "not delivered" |
| Tab crash ("Aw, Snap!") | ✅ None, if ADT has its own process. ❌ If they share one, ADT's page and the Five9 iframe inside it go down, and the call drops. | This is the main reason to make the separation guaranteed (see below) |
| Uses huge amounts of memory or CPU | ⚠️ Possible audio glitches | Machine-wide contention, especially on small Citrix sessions. Chrome doesn't discard pages with an active call or audio. |
| Agent clicks ⋮ → Exit in CRM's Chrome window | ❌ Call drops | Exit closes all Chrome windows, including the installed ADT app |
| Chrome restarts to apply an update | ❌ Call drops | All windows restart together |
| Whole Chrome browser crashes | ❌ Call drops | Rare, but every window shares the browser process |

### How to make it robust

1. **Guarantee ADT its own process.** Set the Chrome enterprise policy `IsolateOrigins` to `https://adt.acme.com,https://crm.acme.com,https://chat.acme.com`. Chrome then never mixes these sites in one process, so a CRM crash or hang can't reach ADT. A weaker alternative without policy is for ADT's server to send the `Origin-Agent-Cluster: ?1` header, which asks Chrome for this but doesn't guarantee it.
2. **Prevent restarts mid-shift.** Use the `RelaunchNotification` and `RelaunchWindow` policies so Chrome only restarts for updates outside working hours.
3. **Train agents not to use ⋮ → Exit.** Closing the CRM tab or window is fine; "Exit" closes everything. No Chrome policy removes the Exit menu item.
4. **Keep ADT from depending on CRM**, as the demo already does. Never make a call-control action wait for a reply from CRM.

### Full isolation is possible, with a catch

You can run ADTCallControl in a completely separate Chrome instance, with its own data folder (`--user-data-dir`). Then even ⋮ → Exit in CRM, or a crash of CRM's Chrome, can't touch the call.

**The catch:** browser messaging such as `BroadcastChannel` only works inside one Chrome instance. With separate instances, the CRM ↔ ADT bridge stops working, and you'd need a relay instead. That means either a server (local or remote) or a Chrome extension with a small helper program on the PC — which brings back exactly what you wanted to avoid.

### Recommendation

Stay with one Chrome instance and set `IsolateOrigins` plus the relaunch policies. That covers the realistic failures: CRM refreshes, hangs and crashes. The remaining risks are an agent using Exit, or a crash of Chrome itself, which is rare.

**To verify the separation yourself:** open Chrome's Task Manager (`Shift+Esc`) during a call. "App: ADTCallControl", the Five9 iframe and "Tab: Acme CRM" should each have a different process ID. You can also test by entering `chrome://crash` in the CRM tab during a test call: only CRM should crash, and the call should continue.
````
