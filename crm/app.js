(() => {
  const $ = (id) => document.getElementById(id);
  const log = new LogView($('log'));
  const status = $('status');

  // Five9 CallData fields shown on the screen pop, when present.
  const CALL_FIELDS = [
    ['Contact', 'contactDisplayName'],
    ['ANI', 'ani'],
    ['DNIS', 'dnis'],
    ['Number', 'number'],
    ['Call type', 'callType'],
    ['Campaign', 'campaignName'],
    ['Agent', 'agentName'],
    ['Interaction ID', 'interactionId'],
  ];

  AgentBus.onStatus((connected) => {
    status.classList.toggle('on', connected);
    status.querySelector('span').textContent = connected ? 'Connected to ADTCallControl' : 'Waiting for ADTCallControl…';
  });

  function renderPop(msg) {
    const callData = msg.payload?.data?.callData ?? {};
    const rows = [
      ['Received', new Date(msg.ts).toLocaleTimeString()],
      ['Source', msg.source === 'five9' ? `Five9 · ${msg.name}` : 'Test message'],
      ...CALL_FIELDS.map(([label, key]) => [label, callData[key]]),
      ['Event ID', msg.id],
    ].filter(([, value]) => value !== undefined && value !== null && value !== '');

    $('popEmpty').hidden = true;
    $('popBody').hidden = false;
    $('popMessage').textContent = msg.payload?.message ?? '';
    $('popMeta').replaceChildren(...rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    }));

    const card = document.querySelector('.screen-pop');
    card.classList.remove('flash');
    void card.offsetWidth;  // restart the animation
    card.classList.add('flash');
  }

  AgentBus.onEvent((msg) => {
    if (msg.eventType !== 'voice') return;
    renderPop(msg);
    log.add({ tag: msg.source === 'five9' ? msg.name : 'voice', tone: 'accent', text: msg.payload?.message ?? '', data: msg });
  });

  $('clearLog').addEventListener('click', () => log.clear());

  // ---- Failure simulation -----------------------------------------------------

  // Matches the window ID ADTCallControl logs ("CRM window da30 connected"), and is
  // what Chrome's Task Manager shows for this tab.
  document.title = `Acme CRM · ${AgentBus.instanceId.slice(0, 4)}`;

  // Give the button label a moment to repaint before the main thread gets blocked.
  // (A timer, not requestAnimationFrame, so it also runs when the window isn't visible.)
  const afterPaint = (fn) => setTimeout(fn, 100);

  // Blocks this page's main thread, like a CRM bug stuck in a loop.
  $('freezeBtn').addEventListener('click', (e) => {
    e.target.textContent = 'Frozen…';
    afterPaint(() => {
      const end = Date.now() + 60_000;
      while (Date.now() < end) { /* busy */ }
      e.target.textContent = 'Freeze CRM (60s)';
    });
  });

  // Web pages can't open chrome://crash, so this exhausts the page's JavaScript memory
  // instead. Chrome then kills this tab's renderer process ("Aw, Snap! Out of memory").
  $('crashBtn').addEventListener('click', (e) => {
    if (!confirm('Crash this CRM tab? It uses a few GB of memory for a few seconds, then the tab shows "Aw, Snap!".')) return;
    e.target.textContent = 'Crashing…';
    afterPaint(() => {
      const hog = [];
      for (;;) hog.push(new Array(1_000_000).fill(Math.random()));
    });
  });
})();
