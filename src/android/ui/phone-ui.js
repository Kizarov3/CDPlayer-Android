// The phone's own pieces of the player's page (with mobile.css): the bar of views at the bottom — the desktop's own
// header buttons, moved there — and QUEUE, which brings the queue up as a sheet.

const NAV = ['shelf-button', 'queue', 'history-button', 'cd-view-button', 'more-button'];

// The status and navigation bars in the theme's background colour, kept so as the theme changes (`setBars`: the Phone
// plugin's). The theme's colours are on the root element (--bg "r, g, b"; html.light for a light one).
export function followTheme(setBars, doc = document) {
  let last = '';
  const look = () => {
    const rgb = getComputedStyle(doc.documentElement).getPropertyValue('--bg').split(',').map((n) => parseInt(n, 10));
    if (rgb.length !== 3 || rgb.some((n) => !(n >= 0 && n <= 255))) return;
    const color = `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    const light = doc.documentElement.classList.contains('light');
    if (`${color}${light}` === last) return;
    last = `${color}${light}`;
    setBars({ color, light });
  };
  new MutationObserver(look).observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  look();
}

export function setUpPhoneUi(doc = document) {
  doc.documentElement.classList.add('android');
  const nav = doc.createElement('nav');
  nav.id = 'phone-nav';
  for (const id of NAV) {
    if (id === 'queue') {
      const b = doc.createElement('button');
      b.id = 'phone-queue-button';
      b.className = 'pill';
      b.textContent = globalThis.cdp?.i18nDict?.().dict?.QUEUE || 'QUEUE'; // (made after the page was translated)
      b.addEventListener('click', () => {
        const on = !doc.body.classList.contains('phone-queue');
        if (on && doc.getElementById('shelf-button')?.classList.contains('on')) doc.getElementById('shelf-button').click(); // (the shelf would stand over the sheet)
        showQueue(doc, on);
      });
      nav.append(b);
      continue;
    }
    const b = doc.getElementById(id);
    if (b) nav.append(b);
  }
  doc.body.append(nav);
  // Another tab takes the queue sheet away (the panels it stood over go too: app.js).
  nav.addEventListener('click', (e) => {
    const tab = e.target.closest('button');
    if (tab && tab.id !== 'phone-queue-button') showQueue(doc, false);
  }, true);
  // A new version's pill: up beside SETTINGS (the header's west side, with the desktop's CD buttons, isn't shown here).
  const update = doc.getElementById('update-button'), east = doc.getElementById('header-east');
  if (update && east) east.prepend(update);
  // The queue sheet's scrim (a tap closes it) and handle (pulled down, it closes).
  const scrim = doc.createElement('div');
  scrim.id = 'phone-scrim';
  scrim.addEventListener('click', () => showQueue(doc, false));
  const handle = doc.createElement('div');
  handle.id = 'phone-sheet-handle';
  pullToClose(handle, doc.getElementById('queue-card'), () => showQueue(doc, false));
  // (beside the sheet: in the player's own stacking, which stands below anything put on the body)
  const sheet = doc.getElementById('queue-card');
  if (sheet) sheet.before(scrim, handle); else doc.body.append(scrim, handle);
  gatherShelfButtons(doc);
  // SHELF in the bar lit while the shelf is open.
  const shelf = doc.getElementById('shelf'), shelfTab = doc.getElementById('shelf-button');
  if (shelf && shelfTab) {
    const lit = () => shelfTab.classList.toggle('on', !shelf.hidden && getComputedStyle(shelf).display !== 'none');
    new MutationObserver(lit).observe(shelf, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    lit();
  }
  // Back closes the queue sheet first (the player's own back — app.js — comes after).
  doc.addEventListener('cdp-back', (e) => {
    if (!doc.body.classList.contains('phone-queue')) return;
    e.stopImmediatePropagation();
    showQueue(doc, false);
  }, true);
}

// The shelf's buttons (all but its search, here-button and CLOSE) into one row that scrolls sideways (mobile.css).
function gatherShelfButtons(doc) {
  const head = doc.getElementById('shelf-head');
  if (!head) return;
  const row = doc.createElement('div');
  row.id = 'phone-shelf-chips';
  for (const b of [...head.querySelectorAll(':scope > button')]) if (b.id !== 'shelf-here' && b.id !== 'shelf-close') row.append(b);
  head.append(row);
}

function showQueue(doc, on) {
  doc.body.classList.toggle('phone-queue', on);
  doc.getElementById('phone-queue-button')?.classList.toggle('on', on);
  if (on) doc.querySelector('#queue-list .queue-row.active')?.scrollIntoView({ block: 'center' });
}

// Dragging `handle` down moves `sheet` with the finger; let go past 80 px (or flicked), it closes, else springs back.
function pullToClose(handle, sheet, close) {
  let y0 = null, t0 = 0, dy = 0;
  handle.addEventListener('pointerdown', (e) => { y0 = e.clientY; t0 = e.timeStamp; dy = 0; handle.setPointerCapture(e.pointerId); if (sheet) sheet.style.transition = 'none'; });
  handle.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    if (sheet) sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (y0 == null) return;
    const fast = dy / Math.max(1, e.timeStamp - t0) > 0.5;
    y0 = null;
    if (sheet) { sheet.style.transition = ''; sheet.style.transform = ''; }
    if (dy > 80 || (fast && dy > 20)) close();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
