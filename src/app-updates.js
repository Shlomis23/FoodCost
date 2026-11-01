// Checks never redraw forms or alter the local recipe database.
export function createAppUpdates({ window, document, navigator, baseUrl, onState, isDirty, reload, now = Date.now }) {
  let registration, flight, candidate, requested = false, reloaded = false, lastAttempt = -Infinity;
  const watched = new WeakSet(), cleanup = [];
  let state = { status: 'starting', offlineReady: false, lastChecked: null, reloadPending: false };
  const emit = patch => { state = { ...state, ...patch }; onState(state); };
  const ready = () => registration?.waiting || (candidate?.state === 'installed' ? candidate : null);
  function watch(worker) {
    if (!worker || watched.has(worker)) return;
    watched.add(worker);
    let activated = worker.state === 'activated';
    const changed = () => {
      if (worker.state === 'activated') {
        activated = true;
        emit({ offlineReady: true, status: state.reloadPending ? 'ready' : 'up-to-date' });
      } else if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        candidate = worker;
        emit({ status: 'ready' });
      } else if (worker.state === 'redundant' && !activated && candidate === worker) {
        candidate = null;
        emit({ status: 'error' });
      } else if (['installing', 'parsed'].includes(worker.state)) emit({ status: 'downloading' });
    };
    worker.addEventListener('statechange', changed);
    cleanup.push(() => worker.removeEventListener('statechange', changed));
    candidate = worker;
    changed();
  }
  function listen(target, name, callback) {
    target.addEventListener(name, callback);
    cleanup.push(() => target.removeEventListener(name, callback));
  }
  async function performCheck() {
    if (navigator.onLine === false) { emit({ status: ready() || state.reloadPending ? 'ready' : 'offline' }); return; }
    emit({ status: ready() || state.reloadPending ? 'ready' : 'checking' });
    try {
      if (!registration) {
        registration = await navigator.serviceWorker.register(`${baseUrl}sw.js`, { scope: baseUrl, updateViaCache: 'none' });
        listen(registration, 'updatefound', () => watch(registration.installing));
        // Registration may already have started installing before our listener exists.
        watch(registration.installing);
        emit({ offlineReady: !!registration.active });
      }
      await registration.update();
      watch(registration.installing);
      emit({ lastChecked: now(), status: ready() || state.reloadPending ? 'ready' : registration.installing ? 'downloading' : candidate?.state === 'redundant' || state.status === 'error' ? 'error' : 'up-to-date' });
    } catch {
      emit({ status: ready() || state.reloadPending ? 'ready' : navigator.onLine === false ? 'offline' : 'error' });
    }
  }
  function check({ force = false } = {}) {
    if (!navigator.serviceWorker) { emit({ status: 'unsupported' }); return Promise.resolve(); }
    if (flight) return flight;
    if (!force && (document.visibilityState === 'hidden' || now() - lastAttempt < 30000)) return Promise.resolve();
    lastAttempt = now();
    flight = performCheck().finally(() => { flight = null; });
    return flight;
  }
  function apply() {
    if (isDirty()) return 'blocked';
    if (state.reloadPending) { if (!reloaded) { reloaded = true; reload(); } return 'reloading'; }
    const worker = ready();
    if (!worker) return 'unavailable';
    requested = true;
    emit({ status: 'applying' });
    worker.postMessage({ type: 'SKIP_WAITING' });
    return 'applying';
  }
  function start() {
    if (!navigator.serviceWorker) return check();
    let previousController = navigator.serviceWorker.controller;
    listen(navigator.serviceWorker, 'controllerchange', () => {
      const hadController = !!previousController;
      previousController = navigator.serviceWorker.controller;
      if (requested && !isDirty() && !reloaded) { reloaded = true; reload(); }
      else emit({ offlineReady: true, reloadPending: hadController || requested, status: hadController || requested ? 'ready' : 'up-to-date' });
    });
    listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') void check({ force: true }); });
    listen(window, 'pageshow', () => { void check({ force: true }); });
    listen(window, 'online', () => { void check({ force: true }); });
    listen(window, 'offline', () => { emit({ status: ready() || state.reloadPending ? 'ready' : 'offline' }); });
    listen(window, 'focus', () => { void check(); });
    const timer = window.setInterval(() => { void check(); }, 300000);
    cleanup.push(() => window.clearInterval(timer));
    return check({ force: true });
  }
  return { start, check, apply, dispose: () => cleanup.splice(0).forEach(fn => fn()), getState: () => state };
}
