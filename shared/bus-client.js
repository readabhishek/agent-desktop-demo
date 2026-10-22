// Connects a CRM or Chat page to the agent bus.
//
// It embeds ADT's bridge.html in a hidden iframe. The bridge runs on ADT's origin, so it
// shares a BroadcastChannel with the ADTCallControl window; this page talks to the bridge
// with postMessage. Presence (ping/pong/hello/bye) and acks are handled here, so apps only
// subscribe to events.
window.AgentBus = (() => {
  const { adtOrigin } = window.DEMO_CONFIG;
  const instanceId = crypto.randomUUID();
  const STALE_MS = 8000;

  const eventHandlers = [];
  const statusHandlers = [];
  const queue = [];
  let ready = false;
  let connected = false;
  let lastHeard = 0;

  const frame = document.createElement('iframe');
  frame.src = `${adtOrigin}/bridge.html`;
  frame.title = 'ADT bridge';
  frame.hidden = true;
  document.body.append(frame);

  function send(fields) {
    const msg = { v: 1, id: crypto.randomUUID(), ts: new Date().toISOString(), instanceId, ...fields };
    if (ready) frame.contentWindow.postMessage(msg, adtOrigin);
    else queue.push(msg);
  }

  function setConnected(value) {
    if (value === connected) return;
    connected = value;
    statusHandlers.forEach((fn) => fn(connected));
  }

  function heard() {
    lastHeard = Date.now();
    setConnected(true);
  }

  addEventListener('message', (e) => {
    if (e.origin !== adtOrigin || e.source !== frame.contentWindow) return;
    const msg = e.data;
    switch (msg?.type) {
      case 'bridge.ready':
        ready = true;
        queue.splice(0).forEach((m) => frame.contentWindow.postMessage(m, adtOrigin));
        send({ type: 'hello' });
        break;
      case 'ping':
        heard();
        send({ type: 'pong' });
        break;
      case 'event':
        heard();
        eventHandlers.forEach((fn) => fn(msg));
        send({ type: 'ack', ackOf: msg.id });
        break;
    }
  });

  setInterval(() => setConnected(Date.now() - lastHeard < STALE_MS), 1000);

  // Re-announce when the window comes back into view, in case ADT restarted meanwhile.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') send({ type: 'hello' });
  });
  addEventListener('pagehide', () => send({ type: 'bye' }));

  return {
    instanceId,
    onEvent: (fn) => eventHandlers.push(fn),
    onStatus: (fn) => {
      statusHandlers.push(fn);
      fn(connected);
    },
  };
})();
