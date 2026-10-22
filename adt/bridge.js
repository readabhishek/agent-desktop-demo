(() => {
  const { channel, crmOrigin, chatOrigin } = window.DEMO_CONFIG;
  const APP_BY_ORIGIN = { [crmOrigin]: 'crm', [chatOrigin]: 'chat' };

  if (window.parent === window) return;
  const host = location.ancestorOrigins?.[0]
    ?? (document.referrer ? new URL(document.referrer).origin : null);
  const app = APP_BY_ORIGIN[host];
  if (!app) return;

  const bus = new BroadcastChannel(channel);

  // Bus → host page: only messages addressed to this app (or everyone).
  bus.onmessage = ({ data }) => {
    if (data?.to === app || data?.to === '*') parent.postMessage(data, host);
  };

  // Host page → bus. The bridge stamps `from`, so CRM cannot pretend to be Chat or ADT.
  addEventListener('message', (e) => {
    if (e.source !== parent || e.origin !== host) return;
    if (!e.data || typeof e.data !== 'object') return;
    bus.postMessage({ ...e.data, from: app });
  });

  parent.postMessage({ v: 1, type: 'bridge.ready', app }, host);
})();
