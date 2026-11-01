import { describe, it, expect, vi } from 'vitest';
import { createAppUpdates } from '../src/app-updates.js';

class Worker extends EventTarget {
  constructor(state) { super(); this.state = state; this.postMessage = vi.fn(); }
  change(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}
function setup({ controlled = true, installing = null, waiting = null, online = true } = {}) {
  const registration = Object.assign(new EventTarget(), { installing, waiting, active: controlled ? {} : null, update: vi.fn().mockResolvedValue(undefined) });
  const serviceWorker = Object.assign(new EventTarget(), { controller: controlled ? {} : null, register: vi.fn().mockResolvedValue(registration) });
  const window = Object.assign(new EventTarget(), { setInterval: vi.fn(() => 1), clearInterval: vi.fn() });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const navigator = { onLine: online, serviceWorker };
  let dirty = false;
  const reload = vi.fn(), onState = vi.fn();
  const app = createAppUpdates({ window, document, navigator, baseUrl: '/FoodCost/', reload, onState, isDirty: () => dirty });
  return { app, registration, navigator, window, document, reload, dirty: value => { dirty = value; } };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
describe('PWA update lifecycle', () => {
  it('checks on launch and every return from background with cache bypass', async () => {
    const x = setup(); await x.app.start();
    expect(x.navigator.serviceWorker.register).toHaveBeenCalledWith('/FoodCost/sw.js', { scope: '/FoodCost/', updateViaCache: 'none' });
    x.document.visibilityState = 'hidden'; x.document.dispatchEvent(new Event('visibilitychange'));
    expect(x.registration.update).toHaveBeenCalledTimes(1);
    x.document.visibilityState = 'visible'; x.document.dispatchEvent(new Event('visibilitychange')); await settle();
    x.window.dispatchEvent(new Event('pageshow')); await settle();
    expect(x.registration.update).toHaveBeenCalledTimes(3);
    x.app.dispose(); x.window.dispatchEvent(new Event('pageshow')); await settle();
    expect(x.registration.update).toHaveBeenCalledTimes(3);
  });
  it('coalesces concurrent checks', async () => {
    const x = setup(); let finish;
    x.registration.update.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const started = x.app.start(); await settle();
    const second = x.app.check({ force: true });
    expect(x.registration.update).toHaveBeenCalledTimes(1); finish(); await Promise.all([started, second]);
  });
  it('observes an installation that started before registration returned', async () => {
    const worker = new Worker('installing'), x = setup({ installing: worker }); await x.app.start();
    expect(x.app.getState().status).toBe('downloading');
    x.registration.installing = null; worker.change('installed');
    expect(x.app.getState().status).toBe('ready');
    x.app.apply(); expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
  it('does not present a failed download as an available update', async () => {
    const worker = new Worker('installing'), x = setup({ installing: worker }); await x.app.start();
    x.registration.installing = null; worker.change('redundant');
    expect(x.app.getState().status).toBe('error'); expect(x.app.apply()).toBe('unavailable');
    await x.app.check({ force: true }); expect(x.app.getState().status).toBe('up-to-date');
  });
  it('blocks activation with drafts, then reloads once after explicit activation', async () => {
    const waiting = new Worker('installed'), x = setup({ waiting }); await x.app.start();
    x.dirty(true); expect(x.app.apply()).toBe('blocked'); expect(waiting.postMessage).not.toHaveBeenCalled();
    x.dirty(false); x.app.apply();
    x.navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    x.navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(x.reload).toHaveBeenCalledTimes(1);
  });
  it('preserves drafts created during activation and offers a later reload', async () => {
    const x = setup({ waiting: new Worker('installed') }); await x.app.start(); x.app.apply(); x.dirty(true);
    x.navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(x.reload).not.toHaveBeenCalled(); expect(x.app.getState().reloadPending).toBe(true);
    x.dirty(false); x.app.apply(); expect(x.reload).toHaveBeenCalledTimes(1);
  });
  it('never reloads automatically when another tab activates an update', async () => {
    const x = setup(); await x.app.start(); x.navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(x.reload).not.toHaveBeenCalled(); expect(x.app.getState().status).toBe('ready');
    x.app.apply(); expect(x.reload).toHaveBeenCalledTimes(1);
  });
  it('first installation enables offline use without an update or reload prompt', async () => {
    const worker = new Worker('installing'), x = setup({ controlled: false, installing: worker }); await x.app.start();
    worker.change('installed'); expect(x.app.getState().status).not.toBe('ready');
    worker.change('activated'); x.navigator.serviceWorker.controller = worker;
    x.navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(x.app.getState().offlineReady).toBe(true); expect(x.reload).not.toHaveBeenCalled(); expect(x.app.getState().status).toBe('up-to-date');
  });
  it('handles offline launch and retries registration on reconnect', async () => {
    const x = setup({ online: false }); await x.app.start();
    expect(x.app.getState().status).toBe('offline'); expect(x.navigator.serviceWorker.register).not.toHaveBeenCalled();
    x.navigator.onLine = true; x.window.dispatchEvent(new Event('online')); await settle();
    expect(x.registration.update).toHaveBeenCalledTimes(1);
  });
  it('retries a failed registration without resetting data', async () => {
    const x = setup(); x.navigator.serviceWorker.register.mockRejectedValueOnce(new Error('network'));
    await x.app.start(); expect(x.app.getState().status).toBe('error');
    await x.app.check({ force: true }); expect(x.app.getState().status).toBe('up-to-date');
  });
});
