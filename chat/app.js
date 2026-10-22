(() => {
  const $ = (id) => document.getElementById(id);
  const log = new LogView($('log'));
  const status = $('status');
  const thread = $('thread');

  // Matches the window ID ADTCallControl logs, and shows in Chrome's Task Manager.
  document.title = `Acme Chat · ${AgentBus.instanceId.slice(0, 4)}`;

  AgentBus.onStatus((connected) => {
    status.classList.toggle('on', connected);
    status.querySelector('span').textContent = connected ? 'Connected to ADTCallControl' : 'Waiting for ADTCallControl…';
  });

  AgentBus.onEvent((msg) => {
    if (msg.eventType !== 'chat') return;
    const text = msg.payload?.message ?? '';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const meta = document.createElement('small');
    const chatData = msg.payload?.data?.chatData;
    meta.textContent = [
      msg.source === 'five9' ? `Five9 ${msg.name}` : 'Test message',
      chatData?.queue,
      chatData?.interactionId && `ID ${chatData.interactionId}`,
      new Date(msg.ts).toLocaleTimeString(),
    ].filter(Boolean).join(' · ');
    bubble.append(text, meta);
    thread.append(bubble);
    bubble.scrollIntoView({ block: 'end', behavior: 'smooth' });

    log.add({ tag: msg.source === 'five9' ? msg.name : 'chat', tone: 'accent', text, data: msg });
  });

  $('clearLog').addEventListener('click', () => {
    log.clear();
    thread.replaceChildren();
  });
})();
