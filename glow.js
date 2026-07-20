(() => {
  'use strict';
  const selector = '.card, .calendar-shell, .week-day, .spacious .list-item, .book-library-card .book-item, .someday-summary-item';
  const wire = element => {
    if (!(element instanceof HTMLElement) || element.dataset.glowReady) return;
    element.dataset.glowReady = 'true';
    element.classList.add('glow-card');
    element.addEventListener('pointerenter', () => element.style.setProperty('--glow-active', '1'));
    element.addEventListener('pointerleave', () => element.style.setProperty('--glow-active', '0'));
    element.addEventListener('pointermove', event => {
      const rect = element.getBoundingClientRect();
      element.style.setProperty('--glow-x', `${event.clientX - rect.left}px`);
      element.style.setProperty('--glow-y', `${event.clientY - rect.top}px`);
    }, { passive: true });
  };
  const scan = root => {
    if (root instanceof Element && root.matches(selector)) wire(root);
    if (root.querySelectorAll) root.querySelectorAll(selector).forEach(wire);
  };
  const start = () => {
    scan(document);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(scan)))
      .observe(document.body, { childList: true, subtree: true });
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
