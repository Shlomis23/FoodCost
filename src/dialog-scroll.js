// Lock before native dialog focus/painting, and keep the lock across nested
// confirmations and synchronous replacement of the app's dialog element.
export function createDialogScrollManager({ document: doc, window: win }) {
  let snapshot = null;
  const watched = new WeakSet();
  const bodyProperties = ['position', 'top', 'left', 'width', 'overflow'];
  const remember = (style, properties) => properties.map(name => [name, style.getPropertyValue(name), style.getPropertyPriority(name)]);
  const restore = (style, properties) => {
    for (const [name, value, priority] of properties) {
      if (value) style.setProperty(name, value, priority);
      else style.removeProperty(name);
    }
  };
  function lock() {
    if (snapshot) return;
    snapshot = {
      x: win.scrollX, y: win.scrollY,
      body: remember(doc.body.style, bodyProperties),
      root: remember(doc.documentElement.style, ['overflow', 'scroll-behavior'])
    };
    doc.documentElement.style.setProperty('overflow', 'hidden');
    doc.documentElement.style.setProperty('scroll-behavior', 'auto');
    doc.documentElement.classList.add('modal-scroll-locked');
    doc.body.style.setProperty('position', 'fixed');
    doc.body.style.setProperty('top', `${-snapshot.y}px`);
    doc.body.style.setProperty('left', `${-snapshot.x}px`);
    doc.body.style.setProperty('width', '100%');
    doc.body.style.setProperty('overflow', 'hidden');
  }
  function unlock() {
    if (!snapshot) return;
    const previous = snapshot;
    snapshot = null;
    restore(doc.body.style, previous.body);
    doc.documentElement.classList.remove('modal-scroll-locked');
    // Restore overflow first, then the exact scroll position without animation.
    restore(doc.documentElement.style, previous.root.filter(([name]) => name !== 'scroll-behavior'));
    win.scrollTo(previous.x, previous.y);
    restore(doc.documentElement.style, previous.root.filter(([name]) => name === 'scroll-behavior'));
  }
  function sync() {
    if (doc.querySelector('dialog[open]')) lock();
    else unlock();
  }
  function open(dialog) {
    if (!watched.has(dialog)) {
      dialog.addEventListener('close', sync);
      watched.add(dialog);
    }
    lock();
    try {
      if (!dialog.open) {
        dialog.showModal();
        dialog.scrollTop = 0;
      }
    } catch (error) {
      sync();
      throw error;
    }
  }
  function close(dialog) {
    if (dialog?.open) dialog.close();
    sync();
  }
  return { open, close, sync };
}
