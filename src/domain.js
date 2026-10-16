import Decimal from 'decimal.js';
export const units = { g: { label: 'גרם', family: 'mass', factor: 1 }, kg: { label: 'ק״ג', family: 'mass', factor: 1000 }, ml: { label: 'מ״ל', family: 'volume', factor: 1 }, l: { label: 'ליטר', family: 'volume', factor: 1000 }, unit: { label: 'יחידה', family: 'count', factor: 1 } };
export const defaults = { target: '30', taxRate: '0', sellingBasis: 'net', rounding: '1' };
export function number(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) throw new Error('יש להזין מספר תקין, ללא מפרידי אלפים');
  const parsed = new Decimal(raw);
  if (raw.length > 80 || !parsed.isFinite() || parsed.gt('1000000000000')) throw new Error('המספר גדול מדי');
  return parsed;
}
export function positive(v, label = 'כמות') { const n = number(v); if (n.lte(0)) throw new Error(`${label} חייבת להיות גדולה מאפס`); return n; }
function percent(v, label) { const n = positive(v, label); if (n.gt(100)) throw new Error(`${label} חייבת להיות עד 100%`); return n; }
export function convert(qty, from, to) {
  if (!units[from] || !units[to] || units[from].family !== units[to].family) throw new Error('היחידות אינן תואמות');
  return positive(qty).mul(units[from].factor).div(units[to].factor);
}
export function validateIngredient(x) {
  if (!x.name?.trim()) throw new Error('יש להזין שם חומר גלם');
  positive(x.purchaseQuantity); percent(x.yieldPercent, 'ניצולת');
  if (!units[x.purchaseUnit]) throw new Error('יש לבחור יחידה');
  if (x.purchasePriceNet !== '') { number(x.purchasePriceNet); if (number(x.purchasePriceNet).eq(0) && !x.zeroConfirmed) throw new Error('מחיר אפס דורש אישור מפורש'); }
}
export function ingredientCost(x) {
  validateIngredient(x);
  if (x.purchasePriceNet === '') throw new Error(`חסר מחיר: ${x.name}`);
  return number(x.purchasePriceNet).div(positive(x.purchaseQuantity).mul(units[x.purchaseUnit].factor).mul(number(x.yieldPercent).div(100)));
}
export function validateSettings(s) {
  percent(s.target, 'יעד Food Cost'); number(s.taxRate); if (number(s.taxRate).gt(100)) throw new Error('שיעור מס לא תקין');
  positive(s.rounding, 'מדרגת עיגול'); if (!['net', 'gross'].includes(s.sellingBasis)) throw new Error('בסיס מחיר לא תקין');
}
export function validateRecipe(x, recipes, ingredients, { complete = false } = {}) {
  if (!x.name?.trim()) throw new Error('יש להזין שם מתכון');
  if (!['dish', 'subrecipe'].includes(x.kind)) throw new Error('סוג מתכון לא תקין');
  positive(x.outputQuantity, 'תפוקה');
  if (x.kind === 'dish' ? x.outputUnit !== 'portion' : !units[x.outputUnit]) throw new Error('יחידת תפוקה לא תקינה');
  if (x.targetOverride) percent(x.targetOverride, 'יעד Food Cost');
  if (x.sellingPrice) positive(x.sellingPrice, 'מחיר');
  if (complete && !x.items.length) throw new Error('יש להוסיף רכיבים');
  for (const row of x.items) {
    positive(row.quantity);
    if (!['ingredient', 'recipe'].includes(row.type)) throw new Error('סוג רכיב לא תקין');
    const component = (row.type === 'ingredient' ? ingredients : recipes).find(v => v.id === row.componentId);
    if (!component) throw new Error('אחד הרכיבים אינו קיים');
    if (row.type === 'recipe' && component.kind !== 'subrecipe') throw new Error('ניתן להוסיף רק מתכון משנה');
    convert(row.quantity, row.unit, row.type === 'ingredient' ? component.purchaseUnit : component.outputUnit);
  }
  const all = recipes.filter(r => r.id !== x.id).concat(x);
  const checked = new Set();
  const visit = (id, path = []) => {
    if (path.includes(id)) throw new Error(`תלות מעגלית: ${[...path, id].map(v => all.find(r => r.id === v)?.name || v).join(' ← ')}`);
    if (path.length > 50) throw new Error('מספר רמות מתכוני המשנה גדול מדי');
    if (checked.has(id)) return;
    for (const row of all.find(r => r.id === id)?.items || []) if (row.type === 'recipe') visit(row.componentId, [...path, id]);
    checked.add(id);
  };
  visit(x.id);
}
export function recipeCost(recipe, recipes, ingredients, path = [], memo = new Map()) {
  if (path.includes(recipe.id)) throw new Error('תלות מעגלית במתכונים');
  if (memo.has(recipe.id)) return memo.get(recipe.id);
  const errors = [], rows = [];
  let total = new Decimal(0);
  if (!recipe.items.length) errors.push('טרם נוספו רכיבים');
  for (const row of recipe.items) {
    let cost = null;
    const component = (row.type === 'ingredient' ? ingredients : recipes).find(x => x.id === row.componentId);
    try {
      if (!component) throw new Error('רכיב חסר');
      if (row.type === 'ingredient') cost = ingredientCost(component).mul(positive(row.quantity).mul(units[row.unit].factor));
      else {
        const nested = recipeCost(component, recipes, ingredients, [...path, recipe.id], memo);
        if (nested.errors.length) throw new Error(nested.errors.join('; '));
        cost = nested.perOutput.mul(convert(row.quantity, row.unit, component.outputUnit));
      }
      total = total.add(cost);
    } catch (e) { errors.push(`${component?.name || 'רכיב'}: ${e.message}`); }
    rows.push({ ...row, name: component?.name || 'רכיב חסר', cost });
  }
  const result = { total, perOutput: total.div(positive(recipe.outputQuantity)), rows, errors };
  memo.set(recipe.id, result);
  return result;
}
export function pricing(cost, recipe, settings) {
  const target = percent(recipe.targetOverride || settings.target, 'יעד');
  const multiplier = settings.sellingBasis === 'gross' ? number(settings.taxRate).div(100).add(1) : new Decimal(1);
  const suggested = cost.div(target.div(100)).mul(multiplier);
  const rounded = suggested.div(settings.rounding).ceil().mul(settings.rounding);
  const actualNet = recipe.sellingPrice ? positive(recipe.sellingPrice).div(multiplier) : null;
  return { target, suggested, rounded, actual: actualNet ? cost.div(actualNet).mul(100) : null, remainder: actualNet ? actualNet.sub(cost) : null, roundedPercent: rounded.gt(0) ? cost.div(rounded.div(multiplier)).mul(100) : new Decimal(0) };
}
export function dependents(id, type, recipes) {
  const found = new Set();
  const visit = (ref, kind) => { for (const r of recipes) if (!found.has(r.id) && r.items.some(i => i.type === kind && i.componentId === ref)) { found.add(r.id); visit(r.id, 'recipe'); } };
  visit(id, type); return recipes.filter(r => found.has(r.id));
}
export function validateBackup(input) {
  if (!input || input.format !== 'winery-food-cost' || input.schemaVersion !== 1) throw new Error('פורמט או גרסת גיבוי אינם נתמכים');
  const d = input.data;
  if (!d || !Array.isArray(d.ingredients) || !Array.isArray(d.recipes) || !d.settings) throw new Error('קובץ הגיבוי חסר נתונים');
  validateSettings(d.settings);
  const ids = new Set();
  for (const x of [...d.ingredients, ...d.recipes]) {
    if (typeof x.id !== 'string' || !x.id || ids.has(x.id) || !Number.isInteger(x.revision) || x.revision < 1) throw new Error('מזהים או גרסאות רשומה לא תקינים');
    ids.add(x.id);
    for (const key of ['name','category','supplierName','notes']) if (x[key] !== undefined && (typeof x[key] !== 'string' || x[key].length > 4000)) throw new Error('שדה טקסט לא תקין בגיבוי');
    for (const key of ['createdAt','updatedAt','priceUpdatedAt','archivedAt']) if (x[key] != null && (typeof x[key] !== 'string' || isNaN(new Date(x[key]).getTime()))) throw new Error('תאריך לא תקין בגיבוי');
    for (const key of ['purchaseQuantity','purchasePriceNet','yieldPercent','outputQuantity','targetOverride','sellingPrice']) if (x[key] !== undefined && typeof x[key] !== 'string') throw new Error('שדה מספרי לא תקין בגיבוי');
    if (x.archivedAt !== null && x.archivedAt !== undefined && typeof x.archivedAt !== 'string') throw new Error('תאריך ארכיון לא תקין');
  }
  for (const x of d.ingredients) validateIngredient(x);
  for (const x of d.recipes) {
    if (!Array.isArray(x.items)) throw new Error('רשימת רכיבים חסרה');
    validateRecipe(x, d.recipes, d.ingredients);
  }
  // Allow-list stored fields: never import arbitrary object properties or HTML.
  const pick = (x, fields) => Object.fromEntries(fields.filter(k => x[k] !== undefined).map(k => [k, x[k]]));
  return {
    ingredients: d.ingredients.map(x => pick(x, ['id','name','category','supplierName','purchaseQuantity','purchaseUnit','purchasePriceNet','yieldPercent','zeroConfirmed','priceUpdatedAt','archivedAt','revision','createdAt','updatedAt'])),
    recipes: d.recipes.map(x => ({ ...pick(x, ['id','name','category','kind','outputQuantity','outputUnit','targetOverride','sellingPrice','notes','archivedAt','revision','createdAt','updatedAt']), items: x.items.map(i => pick(i, ['type','componentId','quantity','unit'])) })),
    settings: pick(d.settings, ['target','taxRate','sellingBasis','rounding'])
  };
}
