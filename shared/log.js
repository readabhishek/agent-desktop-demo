// Newest-first activity log used by all three apps, with the raw message JSON under each entry.
window.LogView = class LogView {
  constructor(listEl, max = 200) {
    this.list = listEl;
    this.max = max;
  }

  add({ tag, text, tone = 'info', data }) {
    const li = document.createElement('li');
    li.className = `entry tone-${tone}`;

    const head = document.createElement('div');
    head.className = 'entry-head';
    const time = document.createElement('time');
    time.textContent = new Date().toLocaleTimeString();
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = tag;
    const body = document.createElement('span');
    body.className = 'entry-text';
    body.textContent = text;
    head.append(time, badge, body);
    li.append(head);

    if (data !== undefined) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Raw message';
      const pre = document.createElement('pre');
      pre.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      details.append(summary, pre);
      li.append(details);
    }

    this.list.prepend(li);
    while (this.list.children.length > this.max) this.list.lastElementChild.remove();
  }

  clear() {
    this.list.replaceChildren();
  }
};
