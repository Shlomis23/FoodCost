import Dexie from 'dexie';
import Decimal from 'decimal.js';
import { defaults, validateBackup, validateIngredient, validateRecipe, validateSettings } from './domain.js';
export const db = new Dexie('kerem-food-cost');
db.version(1).stores({ ingredients: 'id,name,category,archivedAt', recipes: 'id,name,kind,category,archivedAt', meta: 'key' });
export async function readData() {
  return db.transaction('r', db.tables, async () => ({ ingredients: await db.ingredients.toArray(), recipes: await db.recipes.toArray(), settings: { ...defaults, ...(await db.meta.get('settings'))?.value }, meta: (await db.meta.get('state'))?.value || {} }));
}
export async function saveRecord(table, value) {
  return db.transaction('rw', db.tables, async () => {
    const previous = await db[table].get(value.id);
    if (previous && previous.revision !== value.revision) throw new Error('הפריט השתנה בחלון אחר. יש לסגור ולטעון מחדש לפני עריכה');
    if (!previous && value.revision) throw new Error('הפריט אינו קיים עוד. יש לטעון מחדש');
    const ingredients = await db.ingredients.toArray();
    const recipes = await db.recipes.toArray();
    const nextIngredients = table === 'ingredients' ? ingredients.filter(x => x.id !== value.id).concat(value) : ingredients;
    const nextRecipes = table === 'recipes' ? recipes.filter(x => x.id !== value.id).concat(value) : recipes;
    if (table === 'ingredients') validateIngredient(value);
    for (const recipe of nextRecipes) validateRecipe(recipe, nextRecipes, nextIngredients);
    const now = new Date().toISOString();
    await db[table].put({ ...value, revision: (previous?.revision || 0) + 1, createdAt: previous?.createdAt || now, updatedAt: now });
    await touch();
  });
}
async function touch() { const state = (await db.meta.get('state'))?.value || {}; await db.meta.put({ key: 'state', value: { ...state, changedAt: new Date().toISOString(), dataRevision: (state.dataRevision || 0) + 1 } }); }
export async function removeRecord(table, id, revision) {
  await db.transaction('rw', db.tables, async () => {
    const current = await db[table].get(id);
    if (!current || current.revision !== revision) throw new Error('הפריט השתנה. יש לטעון מחדש');
    const type = table === 'ingredients' ? 'ingredient' : 'recipe';
    if ((await db.recipes.toArray()).some(r => r.items.some(i => i.type === type && i.componentId === id))) throw new Error('הפריט בשימוש במתכון ולא ניתן למחוק אותו');
    await db[table].delete(id); await touch();
  });
}
export async function saveSettings(settings, expectedRevision) {
  validateSettings(settings);
  await db.transaction('rw', db.tables, async () => {
    const current = (await db.meta.get('state'))?.value || {};
    if ((current.dataRevision || 0) !== expectedRevision) throw new Error('הנתונים השתנו בחלון אחר. יש לטעון מחדש');
    const previous = { ...defaults, ...(await db.meta.get('settings'))?.value };
    // Preserve net prices when changing the meaning of the selling-price field.
    const oldFactor = previous.sellingBasis === 'gross' ? new Decimal(previous.taxRate).div(100).add(1) : 1;
    const newFactor = settings.sellingBasis === 'gross' ? new Decimal(settings.taxRate).div(100).add(1) : 1;

    for (const r of await db.recipes.toArray()) if (r.sellingPrice) await db.recipes.put({ ...r, sellingPrice: new Decimal(r.sellingPrice).div(oldFactor).mul(newFactor).toString(), revision: r.revision + 1, updatedAt: new Date().toISOString() });
    await db.meta.put({ key: 'settings', value: settings }); await touch();
  });
}
export async function exportBackup() {
  const data = await readData();
  return { format: 'winery-food-cost', schemaVersion: 1, appVersion: '1.0.0', exportedAt: new Date().toISOString(), data: { ingredients: data.ingredients, recipes: data.recipes, settings: data.settings }, dataRevision: data.meta.dataRevision || 0 };
}
export async function markExport(revision) { await db.transaction('rw', db.meta, async () => { const meta = (await db.meta.get('state'))?.value || {}; await db.meta.put({ key: 'state', value: { ...meta, exportedAt: new Date().toISOString(), exportedRevision: revision } }); }); }
export async function restoreBackup(input, expectedRevision) {
  const data = validateBackup(input);
  await db.transaction('rw', db.tables, async () => {
    const meta = (await db.meta.get('state'))?.value || {};
    if ((meta.dataRevision || 0) !== expectedRevision) throw new Error('הנתונים השתנו מאז התצוגה המקדימה. יש לבחור שוב את הקובץ');
    const oldIngredients = await db.ingredients.toArray();
    const oldRecipes = await db.recipes.toArray();
    for (const x of data.ingredients) x.revision = Math.max(x.revision, oldIngredients.find(y => y.id === x.id)?.revision || 0) + 1;
    for (const x of data.recipes) x.revision = Math.max(x.revision, oldRecipes.find(y => y.id === x.id)?.revision || 0) + 1;
    await db.ingredients.clear(); await db.recipes.clear();
    await db.ingredients.bulkPut(data.ingredients); await db.recipes.bulkPut(data.recipes);
    await db.meta.put({ key: 'settings', value: data.settings }); await touch();
  });
}
