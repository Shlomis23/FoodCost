import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import Decimal from 'decimal.js';
import { ingredientCost, recipeCost, pricing, validateRecipe, validateBackup, defaults, convert } from '../src/domain.js';
import { db, saveRecord, readData, exportBackup, restoreBackup, saveSettings, removeRecord } from '../src/db.js';
const ingredient = (overrides={}) => ({id:'i',name:'קמח',revision:0,purchaseQuantity:'2',purchaseUnit:'kg',purchasePriceNet:'40',yieldPercent:'80',zeroConfirmed:false,...overrides});
const row = (overrides={}) => ({type:'ingredient',componentId:'i',quantity:'200',unit:'g',...overrides});
const recipe = (overrides={}) => ({id:'r',revision:0,kind:'dish',name:'מנה',outputQuantity:'1',outputUnit:'portion',targetOverride:'',sellingPrice:'',items:[row()],...overrides});
const backup = (ingredients=[],recipes=[]) => ({format:'winery-food-cost',schemaVersion:1,data:{ingredients,recipes,settings:defaults}});

describe('food cost calculations',()=>{
 it('uses edible yield once, with correct unit conversion',()=>{expect(ingredientCost(ingredient()).toString()).toBe('0.025');expect(recipeCost(recipe(),[],[ingredient()]).perOutput.toString()).toBe('5');});
 it('converts only within the same unit family',()=>{expect(convert('0.5','kg','g').toString()).toBe('500');expect(()=>convert('1','g','ml')).toThrow();});
 it('calculates nested preparations using final output',()=>{
  const i=ingredient({purchaseQuantity:'1',purchaseUnit:'kg',purchasePriceNet:'24',yieldPercent:'100'});
  const a=recipe({id:'a',kind:'subrecipe',outputQuantity:'800',outputUnit:'g',items:[row({quantity:'1000'})]});
  const b=recipe({id:'b',kind:'subrecipe',outputQuantity:'100',outputUnit:'g',items:[row({type:'recipe',componentId:'a',quantity:'50'})]});
  const dish=recipe({items:[row({type:'recipe',componentId:'b',quantity:'100'})]});
  expect(recipeCost(dish,[a,b],[i]).perOutput.toString()).toBe('1.5');
 });
 it('recalculates dependents after a price change',()=>{const r=recipe();expect(recipeCost(r,[],[ingredient({purchasePriceNet:'80'})]).perOutput.toString()).toBe('10');});
 it('divides an entire batch into portions',()=>{expect(recipeCost(recipe({outputQuantity:'10',items:[row({quantity:'7200'})]}),[],[ingredient()]).perOutput.toString()).toBe('18');});
 it('supports target and existing-price calculations',()=>{const p=pricing(new Decimal(18),recipe({sellingPrice:'72'}),defaults);expect(p.suggested.toString()).toBe('60');expect(p.actual.toString()).toBe('25');expect(p.remainder.toString()).toBe('54');});
 it('uses net revenue when prices include tax',()=>{const p=pricing(new Decimal(18),recipe({sellingPrice:'66'}),{...defaults,sellingBasis:'gross',taxRate:'10'});expect(p.actual.toString()).toBe('30');expect(p.suggested.toString()).toBe('66');});
 it('rounds only the suggested price upward',()=>{const p=pricing(new Decimal('18.03'),recipe(),defaults);expect(p.suggested.toString()).toBe('60.1');expect(p.rounded.toString()).toBe('61');});
 it('distinguishes missing price from confirmed zero',()=>{expect(recipeCost(recipe(),[],[ingredient({purchasePriceNet:''})]).errors.length).toBe(1);expect(()=>ingredientCost(ingredient({purchasePriceNet:'0'}))).toThrow();expect(ingredientCost(ingredient({purchasePriceNet:'0',zeroConfirmed:true})).toString()).toBe('0');});
 it('does not hide costs greater than revenue',()=>{expect(pricing(new Decimal(18),recipe({sellingPrice:'9'}),defaults).actual.toString()).toBe('200');});
 it('rejects direct and indirect cycles',()=>{const a=recipe({id:'a',kind:'subrecipe',outputUnit:'g',items:[row({type:'recipe',componentId:'b'})]});const b=recipe({id:'b',kind:'subrecipe',outputUnit:'g',items:[row({type:'recipe',componentId:'a'})]});expect(()=>validateRecipe(a,[a,b],[])).toThrow(/מעגלית/);});
 it('rejects incompatible units and invalid output',()=>{expect(()=>validateRecipe(recipe({outputQuantity:'0'}),[],[ingredient()])).toThrow();expect(()=>validateRecipe(recipe({items:[row({unit:'ml'})]}),[],[ingredient()])).toThrow();});
});

describe('transactional storage and backups',()=>{
 beforeEach(async()=>{await db.transaction('rw',db.tables,async()=>{for(const table of db.tables) await table.clear();});});
 it('exports and restores data and calculations',async()=>{await saveRecord('ingredients',ingredient());await saveRecord('recipes',recipe());const snapshot=await exportBackup();await db.recipes.clear();await restoreBackup(snapshot,2);const state=await readData();expect(state.recipes).toHaveLength(1);expect(recipeCost(state.recipes[0],state.recipes,state.ingredients).perOutput.toString()).toBe('5');});
 it('rejects a malformed backup without changing data',async()=>{await saveRecord('ingredients',ingredient());await expect(restoreBackup(backup([], [{...recipe(),revision:1}]),1)).rejects.toThrow();expect(await db.ingredients.count()).toBe(1);});
 it('rejects duplicate IDs and unsupported schema versions',()=>{expect(()=>validateBackup(backup([{...ingredient(),revision:1},{...ingredient(),revision:1}],[]))).toThrow();expect(()=>validateBackup({...backup(),schemaVersion:2})).toThrow();});
 it('rejects stale edits from another tab',async()=>{await saveRecord('ingredients',ingredient());const first=await db.ingredients.get('i');await saveRecord('ingredients',{...first,purchasePriceNet:'50'});await expect(saveRecord('ingredients',{...first,purchasePriceNet:'60'})).rejects.toThrow();expect((await db.ingredients.get('i')).purchasePriceNet).toBe('50');});
 it('prevents deleting referenced data',async()=>{await saveRecord('ingredients',ingredient());await saveRecord('recipes',recipe());await expect(removeRecord('ingredients','i',1)).rejects.toThrow();});
 it('prevents changing the output family of a used preparation',async()=>{await saveRecord('ingredients',ingredient());await saveRecord('recipes',recipe({id:'sub',kind:'subrecipe',outputUnit:'g'}));await saveRecord('recipes',recipe({items:[row({type:'recipe',componentId:'sub'})]}));const sub=await db.recipes.get('sub');await expect(saveRecord('recipes',{...sub,outputUnit:'ml'})).rejects.toThrow();expect((await db.recipes.get('sub')).outputUnit).toBe('g');});
 it('preserves net prices when changing tax basis',async()=>{await saveRecord('ingredients',ingredient());await saveRecord('recipes',recipe({sellingPrice:'60'}));await saveSettings({...defaults,sellingBasis:'gross',taxRate:'10'},2);expect((await db.recipes.get('r')).sellingPrice).toBe('66');});
 it('rejects restore if data changed since preview',async()=>{await saveRecord('ingredients',ingredient());await expect(restoreBackup(backup(),0)).rejects.toThrow();expect(await db.ingredients.count()).toBe(1);});
 it('invalidates editors opened before restoring the same record',async()=>{await saveRecord('ingredients',ingredient());const old=await db.ingredients.get('i');const snapshot=await exportBackup();await restoreBackup(snapshot,1);await expect(saveRecord('ingredients',old)).rejects.toThrow();});
 it('rolls back a failed bulk write during restore',async()=>{await saveRecord('ingredients',ingredient());const hook=db.recipes.hook('creating',()=>{throw new Error('simulated storage failure');});try{await expect(restoreBackup(backup([{...ingredient({id:'new'}),revision:1}],[{...recipe({items:[row({componentId:'new'})]}),revision:1}]),1)).rejects.toThrow();expect(await db.ingredients.get('i')).toBeTruthy();expect(await db.ingredients.get('new')).toBeUndefined();}finally{db.recipes.hook('creating').unsubscribe(hook);}});
});
