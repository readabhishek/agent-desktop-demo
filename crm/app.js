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
})();
