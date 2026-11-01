import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { ingredientCost, ingredientUsageQuantity, ingredientRecipeUnits, switchIngredientUsage, recipeCost, validateIngredient, validateRecipe, validateBackup, defaults } from '../src/domain.js';
import { db, saveRecord, readData, exportBackup, restoreBackup } from '../src/db.js';
const ingredient = (extra = {}) => ({ id:'weighted', revision:0, name:'גבינה ביחידה', purchaseQuantity:'1', purchaseUnit:'unit', purchasePriceNet:'20', yieldPercent:'100', unitWeightGrams:'200', zeroConfirmed:false, ...extra });
const recipe = (extra = {}) => ({ id:'dish', revision:0, name:'מנה', kind:'dish', outputQuantity:'1', outputUnit:'portion', items:[{type:'ingredient',componentId:'weighted',quantity:'50',unit:'g'}], ...extra });
function cost(i, r = recipe()) { return recipeCost(r, [], [i]); }

describe('weighted units', () => {
  it('prices 50 grams out of a 200 gram unit at one quarter of the unit price', () => {
    expect(cost(ingredient()).perOutput.toString()).toBe('5');
  });
  it('accounts for multiple purchased units', () => {
    expect(cost(ingredient({ purchaseQuantity:'3', purchasePriceNet:'60' })).perOutput.toString()).toBe('5');
  });
  it('applies edible yield once for both gram and count usage', () => {
    const i = ingredient({ yieldPercent:'80' });
    expect(cost(i).perOutput.toString()).toBe('6.25');
    expect(ingredientCost(i).toString()).toBe('25');
    expect(cost(i, recipe({items:[{type:'ingredient',componentId:i.id,quantity:'0.25',unit:'unit'}]})).perOutput.toString()).toBe('6.25');
  });
  it('accepts kilograms and fractional units', () => {
    expect(ingredientUsageQuantity(ingredient(), '0.05', 'kg').toString()).toBe('0.25');
    expect(ingredientUsageQuantity(ingredient(), '0.5', 'unit').toString()).toBe('0.5');
  });
  it('keeps count-based existing recipes unchanged when a weight is added', () => {
    const r=recipe({items:[{type:'ingredient',componentId:'weighted',quantity:'1',unit:'unit'}]});
    expect(cost(ingredient({unitWeightGrams:undefined}),r).perOutput.toString()).toBe('20');
    expect(cost(ingredient(),r).perOutput.toString()).toBe('20');
  });
  it('requires a known weight for gram usage and keeps unweighted count usage available', () => {
    const i=ingredient({unitWeightGrams:''});
    expect(()=>validateRecipe(recipe(),[],[i])).toThrow(/משקל ליחידה/);
    expect(ingredientRecipeUnits(i)).toEqual(['unit']);
    expect(ingredientRecipeUnits(ingredient())).toEqual(['g','kg','unit']);
  });
  it('rejects zero, negative, nonnumeric and non-count weights', () => {
    for (const value of ['0','-2','abc']) expect(()=>validateIngredient(ingredient({unitWeightGrams:value}))).toThrow();
    expect(()=>validateIngredient(ingredient({purchaseUnit:'kg'}))).toThrow();
  });
  it('does not convert units into volume or arbitrary mass into volume', () => {
    expect(()=>ingredientUsageQuantity(ingredient(),'50','ml')).toThrow();
    expect(()=>ingredientUsageQuantity(ingredient({purchaseUnit:'l',unitWeightGrams:''}),'50','g')).toThrow();
  });
  it('propagates the updated weight through a nested recipe without changing unit prices', () => {
    const sub=recipe({id:'sub',kind:'subrecipe',outputUnit:'g',outputQuantity:'100'});
    const dish=recipe({items:[{type:'recipe',componentId:'sub',quantity:'50',unit:'g'}]});
    expect(recipeCost(dish,[sub],[ingredient()]).perOutput.toString()).toBe('2.5');
    expect(recipeCost(dish,[sub],[ingredient({unitWeightGrams:'250'})]).perOutput.toString()).toBe('2');
  });
});

describe('weighted-unit storage and backups', () => {
  beforeEach(async()=>{await db.transaction('rw',db.tables,async()=>{for(const table of db.tables) await table.clear();});});
  it('stores weighted usage and round-trips it in a version 2 backup', async () => {
    await saveRecord('ingredients',ingredient());
    await saveRecord('recipes',recipe());
    const backup=await exportBackup();
    expect(backup.schemaVersion).toBe(2);
    expect(backup.data.ingredients[0].unitWeightGrams).toBe('200');
    await restoreBackup(backup,2);
    const d=await readData();
    expect(d.ingredients[0].unitWeightGrams).toBe('200');
    expect(recipeCost(d.recipes[0],d.recipes,d.ingredients).perOutput.toString()).toBe('5');
  });
  it('imports legacy version 1 data without requiring weights or changing its cost', async () => {
    const i=ingredient({revision:1,unitWeightGrams:undefined});
    const r=recipe({revision:1,items:[{type:'ingredient',componentId:i.id,quantity:'1',unit:'unit'}]});
    await restoreBackup({format:'winery-food-cost',schemaVersion:1,data:{ingredients:[i],recipes:[r],settings:defaults}},0);
    const d=await readData();
    expect(recipeCost(d.recipes[0],d.recipes,d.ingredients).perOutput.toString()).toBe('20');
  });
  it('prevents removing a weight used by a recipe, preserving the saved ingredient', async () => {
    await saveRecord('ingredients',ingredient()); await saveRecord('recipes',recipe());
    const saved=await db.ingredients.get('weighted');
    await expect(saveRecord('ingredients',{...saved,unitWeightGrams:''})).rejects.toThrow(/משקל ליחידה/);
    expect((await db.ingredients.get('weighted')).unitWeightGrams).toBe('200');
  });
  it('rejects a malformed weight in a backup before replacing any data', async () => {
    await saveRecord('ingredients',ingredient());
    const bad={format:'winery-food-cost',schemaVersion:2,data:{ingredients:[ingredient({revision:1,unitWeightGrams:'0'})],recipes:[],settings:defaults}};
    await expect(restoreBackup(bad,1)).rejects.toThrow();
    expect((await db.ingredients.get('weighted')).unitWeightGrams).toBe('200');
    expect(()=>validateBackup({...bad,data:{...bad.data,ingredients:[ingredient({revision:1,unitWeightGrams:200})]}})).toThrow();
  });
});

describe('switching count and gram input modes', () => {
  const row = (extra = {}) => ({type:'ingredient',componentId:'weighted',quantity:'50',unit:'g',...extra});
  it('converts one unit to its full weight without changing the price', () => {
    const original=row({quantity:'1',unit:'unit'});
    const changed=switchIngredientUsage(original,ingredient(),'g');
    expect(changed).toEqual(row({quantity:'200',unit:'g'}));
    expect(cost(ingredient(),recipe({items:[changed]})).perOutput.toString()).toBe('20');
    expect(original.unit).toBe('unit');
  });
  it('converts a gram portion to fractional units and keeps a single consumption amount', () => {
    const original=row();
    const changed=switchIngredientUsage(original,ingredient(),'unit');
    expect(changed).toEqual(row({quantity:'0.25',unit:'unit'}));
    expect(cost(ingredient(),recipe({items:[changed]})).perOutput.toString()).toBe('5');
    expect(original.quantity).toBe('50');
  });
  it('displays existing kilogram usage in grams without changing its cost', () => {
    const changed=switchIngredientUsage(row({quantity:'0.05',unit:'kg'}),ingredient(),'g');
    expect(changed.quantity).toBe('50');
    expect(cost(ingredient(),recipe({items:[changed]})).perOutput.toString()).toBe('5');
  });
  it('does not apply yield again when switching modes', () => {
    const i=ingredient({yieldPercent:'80'});
    const changed=switchIngredientUsage(row(),i,'unit');
    const back=switchIngredientUsage(changed,i,'g');
    expect(back.quantity).toBe('50');
    expect(cost(i,recipe({items:[changed]})).perOutput.toString()).toBe('6.25');
    expect(cost(i,recipe({items:[back]})).perOutput.toString()).toBe('6.25');
  });
  it('allows switching an empty quantity so it can be entered in the new mode', () => {
    expect(switchIngredientUsage(row({quantity:'',unit:'unit'}),ingredient(),'g')).toEqual(row({quantity:'',unit:'g'}));
  });
  it('blocks grams without a configured unit weight', () => {
    expect(()=>switchIngredientUsage(row({unit:'unit'}),ingredient({unitWeightGrams:''}),'g')).toThrow(/משקל ליחידה/);
  });
  it('rejects invalid quantities and unsupported usage modes', () => {
    expect(()=>switchIngredientUsage(row({quantity:'abc'}),ingredient(),'unit')).toThrow();
    expect(()=>switchIngredientUsage(row(),ingredient(),'ml')).toThrow();
  });
  it('leaves a quantity untouched when its mode is selected again', () => {
    const original=row({quantity:'50.25'});
    expect(switchIngredientUsage(original,ingredient(),'g')).toEqual(original);
  });
});
