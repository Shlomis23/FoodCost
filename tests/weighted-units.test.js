import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { ingredientCost, ingredientUsageQuantity, ingredientRecipeUnits, recipeCost, validateIngredient, validateRecipe, validateBackup, defaults } from '../src/domain.js';
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
