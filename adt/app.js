(() => {
  const cfg = window.DEMO_CONFIG;
  const FIVE9_ORIGIN = new URL(cfg.five9Url).origin;
  const ROUTES = { voice: 'crm', chat: 'chat' };            // eventType → receiving app
  const APPS = {
    crm: { label: 'CRM', url: `${cfg.crmOrigin}/` },
    chat: { label: 'Chat', url: `${cfg.chatOrigin}/` },
  };
  const PING_MS = 3000;
  const PEER_TIMEOUT_MS = 8000;
  const ACK_TIMEOUT_MS = 2000;

  const $ = (id) => document.getElementById(id);
  const log = new LogView($('log'));
  const bus = new BroadcastChannel(cfg.channel);
  const peers = new Map();    // instanceId → { app, lastSeen }
  const pending = new Map();  // event id → number of acks received

  const envelope = (fields) => ({ v: 1, id: crypto.randomUUID(), ts: new Date().toISOString(), from: 'adt', ...fields });
  const shortId = (id) => id.slice(0, 4);

  $('five9').src = cfg.five9Url;

  // ---- Presence: who is listening on the bus ----------------------------------

  function renderPeers() {
    for (const app of Object.keys(APPS)) {
      const count = [...peers.values()].filter((p) => p.app === app).length;
      const pill = $(`${app}Pill`);
      pill.classList.toggle('on', count > 0);
      pill.querySelector('b').textContent = count;
    }
  }

  function seen(msg) {
    const isNew = !peers.has(msg.instanceId);
    peers.set(msg.instanceId, { app: msg.from, lastSeen: Date.now() });
    if (isNew) {
      log.add({ tag: 'bus', tone: 'ok', text: `${APPS[msg.from].label} window ${shortId(msg.instanceId)} connected` });
      renderPeers();
    }
  }

  function drop(instanceId, reason) {
    const peer = peers.get(instanceId);
    if (!peer) return;
    peers.delete(instanceId);
    log.add({ tag: 'bus', tone: 'warn', text: `${APPS[peer.app].label} window ${shortId(instanceId)} ${reason}` });
    renderPeers();
  }

  function ping() {
    bus.postMessage(envelope({ type: 'ping', to: '*' }));
    const cutoff = Date.now() - PEER_TIMEOUT_MS;
    for (const [id, peer] of peers) if (peer.lastSeen < cutoff) drop(id, 'stopped responding');
  }

  bus.onmessage = ({ data: msg }) => {
    if (!msg || !APPS[msg.from] || !msg.instanceId) return;
    switch (msg.type) {
      case 'hello':
        seen(msg);
        bus.postMessage(envelope({ type: 'ping', to: msg.from }));
        break;
      case 'pong':
        seen(msg);
        break;
      case 'bye':
        drop(msg.instanceId, 'closed');
        break;
      case 'ack':
        seen(msg);
        if (pending.has(msg.ackOf)) {
          pending.set(msg.ackOf, pending.get(msg.ackOf) + 1);
          log.add({ tag: 'ack', tone: 'ok', text: `Delivered to ${APPS[msg.from].label} window ${shortId(msg.instanceId)}`, data: msg });
        }
        break;
    }
  };

  ping();
  setInterval(ping, PING_MS);

  // ---- Sending events ---------------------------------------------------------

  // `source` is 'five9' for real ADT events and 'manual' for the test form.
  function publish({ eventType, name, source, message, data }) {
    const to = ROUTES[eventType];
    const msg = envelope({ type: 'event', to, eventType, name, source, payload: { message, data } });
    bus.postMessage(msg);
    log.add({ tag: source === 'five9' ? 'five9' : 'sent', tone: 'accent', text: `${eventType} → ${APPS[to].label}: ${message}`, data: msg });

    pending.set(msg.id, 0);
    setTimeout(() => {
      if (pending.get(msg.id) === 0) {
        log.add({ tag: 'not delivered', tone: 'warn', text: `No ${APPS[to].label} window acknowledged it. Is ${APPS[to].label} open?` });
      }
      pending.delete(msg.id);
    }, ACK_TIMEOUT_MS);
  }

  $('sendForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('message').value.trim();
    if (!text) return;
    publish({ eventType: $('eventType').value, name: 'manual', source: 'manual', message: text });
    $('message').value = '';
    $('message').focus();
  });

  $('message').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('sendForm').requestSubmit();
    }
  });

  $('clearLog').addEventListener('click', () => log.clear());

  // ---- Messages posted by the Five9 iframe (logged so you can see what it emits) ----

  // The ADT's plugins repeatedly post `connect` handshakes looking for the Five9 CRM SDK,
  // so this traffic is counted always but only logged when the checkbox is on.
  let five9Count = 0;
  addEventListener('message', (e) => {
    if (e.origin !== FIVE9_ORIGIN) return;
    $('five9Count').textContent = ++five9Count;
    if (!$('showFive9').checked) return;
    const d = e.data;
    const text = d && typeof d === 'object' && d.message
      ? `${d.message}${d.iframeName ? ` (${d.iframeName})` : ''}`
      : 'message';
    log.add({ tag: 'five9', text, data: d });
  });

  // ---- Five9 CRM SDK: real call and chat events -------------------------------

  // The SDK finds the ADT iframe on this page by itself and delivers its events here.
  // Calls go to CRM, chats go to Chat. Email events are only logged.
  const CALL_EVENTS = {
    callStarted: 'Call started',
    callAccepted: 'Call accepted',
    callRejected: 'Call rejected',
    callEnded: 'Call ended',
    callFinished: 'Call finished',
  };
  const CHAT_EVENTS = {
    chatOffered: 'Chat offered',
    chatAccepted: 'Chat accepted',
    chatRejected: 'Chat rejected',
    chatTransferred: 'Chat transferred',
    chatEnded: 'Chat ended',
    chatFinished: 'Chat finished',
  };
  const EMAIL_EVENTS = ['emailOffered', 'emailAccepted', 'emailRejected', 'emailTransferred', 'emailFinished'];

  const describeCall = ({ callData: c = {} } = {}) =>
    [c.contactDisplayName || c.ani || c.number, c.callType, c.campaignName].filter(Boolean).join(' · ') || 'unknown caller';
  const describeChat = ({ chatData: c = {} } = {}) =>
    [c.contactDisplayName || c.email, c.mediaSubtype, c.subject].filter(Boolean).join(' · ') || 'unknown contact';

  const five9Handlers = {};
  for (const [name, label] of Object.entries(CALL_EVENTS)) {
    five9Handlers[name] = (params) =>
      publish({ eventType: 'voice', name, source: 'five9', message: `${label}: ${describeCall(params)}`, data: params });
  }
  for (const [name, label] of Object.entries(CHAT_EVENTS)) {
    five9Handlers[name] = (params) =>
      publish({ eventType: 'chat', name, source: 'five9', message: `${label}: ${describeChat(params)}`, data: params });
  }
  for (const name of EMAIL_EVENTS) {
    five9Handlers[name] = (params) => log.add({ tag: 'five9', text: `${name} (email is not routed in this demo)`, data: params });
  }

  const sdkScript = document.createElement('script');
  sdkScript.src = cfg.five9SdkUrl;
  sdkScript.onload = () => {
    window.Five9.CrmSdk.interactionApi().subscribe(five9Handlers);
    log.add({ tag: 'five9', tone: 'ok', text: 'Five9 CRM SDK loaded. Listening for call and chat events.' });
  };
  sdkScript.onerror = () => {
    log.add({ tag: 'five9', tone: 'warn', text: `Could not load the Five9 CRM SDK from ${cfg.five9SdkUrl}` });
  };
  document.head.append(sdkScript);

  // For testing without a live interaction, e.g. from DevTools:
  //   ADTCallControl.five9.callStarted({ callData: { ani: '5550100', callType: 'INBOUND' } })
  window.ADTCallControl = { five9: five9Handlers };

  // ---- Opening CRM and Chat in Chrome ------------------------------------------

  // CRM and Chat are regular web pages, so they open as normal Chrome tabs (with the
  // address bar and Chrome's taskbar icon), not as app or popup windows.
  //
  // `noopener` is essential: without it the new tab keeps a window.opener link to ADT,
  // and Chrome must then run these same-site pages in ONE renderer process, so a CRM
  // freeze or crash would take ADT (and the Five9 call) down with it. The bus doesn't
  // need the link. The trade-off is that ADT can't focus an existing tab, so it opens
  // a new one only when none is connected.
  function openApp(app) {
    const open = [...peers.entries()].filter(([, p]) => p.app === app);
    if (open.length) {
      const ids = open.map(([id]) => shortId(id)).join(', ');
      log.add({ tag: 'bus', text: `${APPS[app].label} is already open (window ${ids}). Switch to it in Chrome.` });
      return;
    }
    window.open(APPS[app].url, '_blank', 'noopener');
  }

  $('openCrm').addEventListener('click', () => openApp('crm'));
  $('openChat').addEventListener('click', () => openApp('chat'));

  // ---- Memory footprint ---------------------------------------------------------

  // Pages can't read their process memory; Chrome's performance.memory gives this page's
  // JavaScript heap (rounded by Chrome). Not available in non-Chromium browsers.
  if (performance.memory) {
    const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
    const pill = $('memPill');
    const note = pill.title;
    const showMemory = () => {
      const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = performance.memory;
      $('memUsed').textContent = mb(usedJSHeapSize);
      pill.title = `${mb(usedJSHeapSize)} used of ${mb(totalJSHeapSize)} allocated (limit ${mb(jsHeapSizeLimit)})\n\n${note}`;
    };
    pill.hidden = false;
    showMemory();
    setInterval(showMemory, 2000);
  }

  // ---- Install as an app ------------------------------------------------------

  let deferredPrompt = null;
  const installBtn = $('installBtn');

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  addEventListener('appinstalled', () => { installBtn.hidden = true; });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  }
})();
