import { beforeEach, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { db, readData, exportBackup, restoreBackup } from '../src/db.js';
import { shouldShowTutorial, completeTutorial } from '../src/tutorial.js';
beforeEach(async () => { await db.meta.clear(); });
it('shows on first entry and remembers dismissal after reopening storage', async () => {
  expect(await shouldShowTutorial()).toBe(true);
  await completeTutorial();
  db.close();
  await db.open();
  expect(await shouldShowTutorial()).toBe(false);
});
it('does not mark business data as changed or include device preferences in backups', async () => {
  await completeTutorial();
  expect((await readData()).meta.dataRevision).toBeUndefined();
  expect(JSON.stringify(await exportBackup())).not.toContain('tutorial');
});
it('keeps the device preference when business data is restored', async () => {
  const snapshot = await exportBackup();
  await completeTutorial();
  await restoreBackup(snapshot, 0);
  expect(await shouldShowTutorial()).toBe(false);
});
