import { expect, it } from 'vitest';
import { findComponents } from '../src/component-picker.js';
const data={ingredients:[{id:'cheese',name:'גבינת עיזים',category:'מוצרי חלב'},{id:'oil',name:'שמן זית'},{id:'old',name:'גבינה ישנה',archivedAt:'2026-01-01'}],recipes:[{id:'sauce',name:'רוטב עיזים',kind:'subrecipe'},{id:'dish',name:'סלט עיזים',kind:'dish'},{id:'self',name:'מתכון עצמי',kind:'subrecipe'}]};
it('searches ingredient names and preparation names together',()=>{expect(findComponents(data,'עיזים','self').map(x=>x.record.id).sort()).toEqual(['cheese','sauce']);});
it('matches Hebrew vowel marks, multiple keywords and categories',()=>{expect(findComponents(data,'גְבִינַת עִיזִּים','self').map(x=>x.record.id)).toEqual(['cheese']);expect(findComponents(data,'חלב עיזים','self').map(x=>x.record.id)).toEqual(['cheese']);});
it('excludes archived records, finished dishes and the edited recipe',()=>{expect(findComponents(data,'','self').map(x=>x.record.id).sort()).toEqual(['cheese','oil','sauce']);});
it('shows an empty result for a nonmatching term without changing source data',()=>{const before=JSON.stringify(data);expect(findComponents(data,'קמח','self')).toEqual([]);expect(JSON.stringify(data)).toBe(before);});
it('returns all eligible records when the search is cleared',()=>{expect(findComponents(data,'   ','self')).toHaveLength(3);});
