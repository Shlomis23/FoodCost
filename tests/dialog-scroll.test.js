import { it, expect } from 'vitest';
import { createDialogScrollManager } from '../src/dialog-scroll.js';

function environment() {
  const style = () => {
    const values = new Map();
    return {
      setProperty: (key, value, priority = '') => values.set(key, { value, priority }),
      getPropertyValue: key => values.get(key)?.value || '',
      getPropertyPriority: key => values.get(key)?.priority || '',
      removeProperty: key => values.delete(key)
    };
  };
  const classes = new Set(), dialogs = [];
  const root = { style: style(), classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key) } };
  const doc = { body: { style: style() }, documentElement: root, querySelector: () => dialogs.find(d => d.open && d.connected) || null };
  const positions = [];
  const win = { scrollX: 0, scrollY: 430, scrollTo(x, y) { positions.push([x, y]); this.scrollX = x; this.scrollY = y; } };
  const makeDialog = () => {
    const listeners = {};
    const dialog = { open: false, connected: true, scrollTop: 90,
      addEventListener: (type, callback) => { listeners[type] = callback; },
      showModal() {
        expect(doc.body.style.getPropertyValue('position')).toBe('fixed');
        expect(root.style.getPropertyValue('overflow')).toBe('hidden');
        this.open = true;
        win.scrollY = 0;
      },
      close() { this.open = false; listeners.close?.(); }
    };
    dialogs.push(dialog);
    return dialog;
  };
  return { doc, win, root, positions, makeDialog, manager: createDialogScrollManager({ document: doc, window: win }) };
}

it('locks the background before showing the dialog and starts its scroll at the top', () => {
  const e = environment(), dialog = e.makeDialog();
  e.manager.open(dialog);
  expect(e.doc.body.style.getPropertyValue('top')).toBe('-430px');
  expect(dialog.scrollTop).toBe(0);
  expect(e.root.classList.contains('modal-scroll-locked')).toBe(true);
});
it('restores the original scroll position and inline style values on close', () => {
  const e = environment(), dialog = e.makeDialog();
  e.doc.body.style.setProperty('position', 'relative', 'important');
  e.doc.body.style.setProperty('width', '85%');
  e.root.style.setProperty('scroll-behavior', 'smooth');
  e.manager.open(dialog);
  e.manager.close(dialog);
  expect(e.positions).toEqual([[0, 430]]);
  expect(e.doc.body.style.getPropertyValue('position')).toBe('relative');
  expect(e.doc.body.style.getPropertyPriority('position')).toBe('important');
  expect(e.doc.body.style.getPropertyValue('width')).toBe('85%');
  expect(e.doc.body.style.getPropertyValue('top')).toBe('');
  expect(e.root.style.getPropertyValue('scroll-behavior')).toBe('smooth');
});
it('keeps the background locked when a nested confirmation closes', () => {
  const e = environment(), parent = e.makeDialog(), confirmation = e.makeDialog();
  e.manager.open(parent);
  e.manager.open(confirmation);
  e.manager.close(confirmation);
  expect(e.doc.body.style.getPropertyValue('position')).toBe('fixed');
  expect(e.positions).toHaveLength(0);
  e.manager.close(parent);
  expect(e.positions).toEqual([[0, 430]]);
});
it('keeps the original position across synchronous dialog replacement', () => {
  const e = environment(), old = e.makeDialog();
  e.manager.open(old);
  old.connected = false;
  const replacement = e.makeDialog();
  e.manager.open(replacement);
  e.manager.sync();
  expect(e.positions).toHaveLength(0);
  e.manager.close(replacement);
  expect(e.positions).toEqual([[0, 430]]);
});
it('releases the lock after a save replaces the dialog with the normal page', () => {
  const e = environment(), dialog = e.makeDialog();
  e.manager.open(dialog);
  dialog.connected = false;
  e.manager.sync();
  e.manager.sync();
  expect(e.positions).toEqual([[0, 430]]);
  expect(e.root.classList.contains('modal-scroll-locked')).toBe(false);
});
it('does not reset the current dialog scroll when its content is redrawn', () => {
  const e = environment(), dialog = e.makeDialog();
  e.manager.open(dialog);
  dialog.scrollTop = 240;
  e.manager.open(dialog);
  expect(dialog.scrollTop).toBe(240);
  e.manager.close(dialog);
  expect(e.positions).toEqual([[0, 430]]);
});
it('releases the lock when native close is used', () => {
  const e = environment(), dialog = e.makeDialog();
  e.manager.open(dialog);
  dialog.close();
  expect(e.positions).toEqual([[0, 430]]);
});
it('restores the page if native showModal fails', () => {
  const e = environment(), dialog = e.makeDialog();
  dialog.showModal = () => { throw new Error('cannot open'); };
  expect(() => e.manager.open(dialog)).toThrow('cannot open');
  expect(e.doc.body.style.getPropertyValue('position')).toBe('');
  expect(e.positions).toEqual([[0, 430]]);
});
