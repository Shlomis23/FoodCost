import './style.css';
import { createIcons, Grape, Utensils, CookingPot, Wheat, Settings, Plus, Search, ArrowLeft, X, Download, Upload, ShieldCheck, WifiOff, Check, Pencil, Copy, Archive, Trash2, CircleHelp, Leaf, ChevronLeft, ChefHat, RefreshCw } from 'lucide';
import { units, defaults, ingredientCost, recipeCost, pricing, validateIngredient, validateRecipe, validateSettings, validateBackup, dependents, number } from './domain.js';
import { db, readData, saveRecord, removeRecord, saveSettings, exportBackup, markExport, restoreBackup } from './db.js';
const icons = { Grape, Utensils, CookingPot, Wheat, Settings, Plus, Search, ArrowLeft, X, Download, Upload, ShieldCheck, WifiOff, Check, Pencil, Copy, Archive, Trash2, CircleHelp, Leaf, ChevronLeft, ChefHat, RefreshCw };
import { tutorialSteps, shouldShowTutorial, completeTutorial } from './tutorial.js';
const app = document.querySelector('#app');
let tutorialIndex = null;
let data = { ingredients: [], recipes: [], settings: defaults, meta: {} }, route = 'dishes', query = '', category = '', showArchive = false, editor = null, detailId = null, dirty = false, pendingRestore = null, registration, offlineReady = false;
let toastTimer;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const icon = name => `<i data-lucide="${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}" aria-hidden="true"></i>`;
const money = (v, precision = 2) => v === null || v === undefined ? '—' : new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: precision, maximumFractionDigits: precision }).format(Number(v));
const pct = v => v === null || v === undefined ? '—' : `${Number(v).toFixed(1).replace('.0','')}%`;
const date = v => v ? new Intl.DateTimeFormat('he-IL', { day:'numeric', month:'short', year:'numeric' }).format(new Date(v)) : 'טרם נוצר';
function toast(message, error = false) {
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  const dialog = dialogs.at(-1);
  let el = document.querySelector('#toast');
  if (dialog) {
    el = dialog.querySelector('.dialog-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'dialog-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      dialog.append(el);
    }
  }
  el.textContent = message;
  const baseClass = dialog ? 'dialog-toast' : '';
  el.className = `${baseClass} visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = baseClass; }, 5000);
}
function refreshIcons() { createIcons({ icons, attrs: { 'stroke-width': 1.7 } }); }
async function refresh() { data = await readData(); render(); }
function safeCost(r) { try { return recipeCost(r, data.recipes, data.ingredients); } catch (e) { return { errors: [e.message], total: null, perOutput: null, rows: [] }; } }
function labelForKind() { return route === 'ingredients' ? 'חומר גלם' : route === 'subrecipes' ? 'מתכון משנה' : 'מנה'; }
function currentRecords() { return route === 'ingredients' ? data.ingredients : data.recipes.filter(x => x.kind === (route === 'subrecipes' ? 'subrecipe' : 'dish')); }
function nav() { return [['dishes','Utensils','המנות שלי'],['subrecipes','CookingPot','מתכוני משנה'],['ingredients','Wheat','חומרי גלם'],['settings','Settings','הגדרות וגיבוי']].map(([id, i, text]) => `<a href="#/${id}" class="nav-link ${route === id ? 'active' : ''}" ${route === id ? 'aria-current="page"' : ''}>${icon(i)}<span>${text}</span>${route === id ? '<b></b>' : ''}</a>`).join(''); }
function render() {
  app.innerHTML = `<aside class="sidebar"><a class="brand" href="#/dishes"><span class="brand-mark">${icon('Grape')}</span><span><strong>כרם</strong><small>FOOD COST STUDIO</small></span></a><div class="sidebar-label">מהמטבח, עד לתפריט</div><nav aria-label="ניווט ראשי">${nav()}</nav><div class="sidebar-foot"><div class="local-note">${icon('ShieldCheck')}<span><strong>המידע נשאר אצלך</strong><small>שמירה מקומית במכשיר</small></span></div><span class="version">כרם · גרסה 1.0</span></div></aside>
  <div class="workspace"><header class="topbar"><span class="breadcrumb">היקב שלי <span>/</span> ${route === 'settings' ? 'הגדרות וגיבוי' : route === 'ingredients' ? 'חומרי גלם' : route === 'subrecipes' ? 'מתכוני משנה' : 'המנות שלי'}</span><div class="connection ${navigator.onLine ? '' : 'offline'}">${icon(navigator.onLine ? 'ShieldCheck' : 'WifiOff')}<span>${!navigator.onLine ? 'עבודה ללא רשת' : offlineReady ? 'מוכן לעבודה ללא רשת' : 'הנתונים נשמרים במכשיר'}</span></div></header><main id="main">${route === 'settings' ? settingsView() : listView()}</main><footer class="page-footer"><span>כל מנה טובה מתחילה בפרטים הקטנים.</span><span>כרם · תמחור עם מחשבה</span></footer></div><nav class="mobile-nav" aria-label="ניווט נייד">${nav()}</nav><dialog id="modal"></dialog>`;
  refreshIcons(); if (tutorialIndex !== null) drawTutorial(); else if (editor) drawEditor(); else if (detailId) drawDetail(detailId); if (registration?.waiting) showUpdateButton();
}
function listView() {
  const ingredients = route === 'ingredients', subs = route === 'subrecipes', all = currentRecords(), active = all.filter(x => !x.archivedAt);
  const validDishes = data.recipes.filter(r => r.kind === 'dish' && !r.archivedAt).map(r => ({ r, cost: safeCost(r) })).filter(x => !x.cost.errors.length);
  const above = validDishes.filter(({r,cost}) => { const p = pricing(cost.perOutput,r,data.settings); return p.actual?.gt(p.target); }).length;
  const stats = ingredients ? [[active.length,'חומרי גלם במטבח','Wheat'],[active.filter(x => x.purchasePriceNet === '').length,'ממתינים להזנת מחיר','Pencil'],[data.recipes.filter(x => !x.archivedAt).length,'מתכונים ומנות','CookingPot']] : subs ? [[active.length,'מתכוני משנה','CookingPot'],[active.filter(x => !safeCost(x).errors.length).length,'מתכונים מוכנים לחישוב','Check'],[data.recipes.filter(x => x.kind === 'dish' && !x.archivedAt).length,'מנות בתפריט','Utensils']] : [[active.length,'מנות בתפריט','Utensils'],[`${data.settings.target}%`,'יעד Food Cost כללי','Leaf'],[above,'מנות מעל היעד','ChefHat']];
  const title = ingredients ? 'הבסיס לכל מנה טובה.' : subs ? 'מכינים פעם. משתמשים שוב.' : 'טעם טוב. תמחור מדויק.';
  const sub = ingredients ? 'כל חומרי הגלם, המחירים והכמויות — במקום אחד.' : subs ? 'רטבים, בצקים וממרחים שמרכיבים את המנות שלך.' : 'כל המנות שלך, עם המספרים שעושים את ההבדל.';
  const filtered = all.filter(x => Boolean(x.archivedAt) === showArchive && (!category || x.category === category) && x.name.toLocaleLowerCase('he').includes(query.toLocaleLowerCase('he')));
  const cats = [...new Set(all.map(x => x.category).filter(Boolean))].sort();
  const needsBackup = (data.meta.dataRevision || 0) > (data.meta.exportedRevision || 0) && (!data.meta.exportedAt || Date.now() - new Date(data.meta.exportedAt).getTime() > 7 * 86400000);
  return `<section class="page-heading"><div><div class="eyebrow">${ingredients ? 'חומרי גלם' : subs ? 'מתכוני משנה' : 'מהמטבח לתפריט'}</div><h1>${title}</h1><p>${sub}</p></div><button class="primary" data-action="new">${icon('Plus')}הוספת ${labelForKind()}</button></section>
  <section class="stats" aria-label="סיכום">${stats.map(([v,l,i],n) => `<div class="stat"><div><span>${l}</span><strong>${v}</strong></div><span class="stat-icon tone-${n}">${icon(i)}</span></div>`).join('')}</section>
  ${needsBackup ? `<div class="backup-nudge">${icon('ShieldCheck')}<span>יש נתונים שטרם גובו. כדאי לשמור עותק מחוץ למכשיר.</span><button class="text-button" data-action="export">יצירת גיבוי ${icon('ArrowLeft')}</button></div>` : ''}
  <section class="collection"><div class="collection-heading"><div><h2>${ingredients ? 'המזווה שלי' : subs ? 'ההכנות שלי' : 'המנות שלי'}</h2><span>${filtered.length} ${ingredients ? 'חומרי גלם' : subs ? 'מתכונים' : 'מנות'}${showArchive ? ' בארכיון' : ''}</span></div><label class="archive-filter"><input type="checkbox" id="archive-filter" ${showArchive ? 'checked' : ''}> הצגת ארכיון</label></div>
  <div class="toolbar"><label class="search">${icon('Search')}<input id="search" type="search" placeholder="חיפוש ${ingredients ? 'חומר גלם' : 'מתכון או מנה'}…" aria-label="חיפוש" value="${esc(query)}"></label><select id="category-filter" aria-label="סינון לפי קטגוריה"><option value="">כל הקטגוריות</option>${cats.map(c => `<option ${category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
  <div id="records">${filtered.length ? `<div class="record-grid">${filtered.map(x => ingredients ? ingredientCard(x) : recipeCard(x)).join('')}</div>` : `<div class="empty"><span class="empty-icon">${icon(ingredients ? 'Wheat' : subs ? 'CookingPot' : 'Utensils')}</span><h3>${query || category || showArchive ? 'לא נמצאו פריטים' : ingredients ? 'כאן מתחיל התמחור שלך' : subs ? 'הסוד נמצא בהכנות' : 'המנה הראשונה שלך מחכה'}</h3><p>${query || category || showArchive ? 'אפשר לשנות את החיפוש או את הסינון.' : ingredients ? 'הוסיפי חומרי גלם עם מחיר וכמות אריזה, ונחשב את העלות.' : subs ? 'צרי מתכון לרוטב, בצק או ממרח, והשתמשי בו בכל מנה.' : 'הוסיפי חומרי גלם ובני מנה כדי לגלות כמה היא באמת עולה.'}</p>${!(query || category || showArchive) ? `<button class="secondary" data-action="new">${icon('Plus')}הוספת ${labelForKind()}</button>` : ''}</div>`}</div></section>
  ${!all.length && !query && !showArchive ? `<section class="getting-started"><span class="guide-icon">${icon('CircleHelp')}</span><div><h3>מקום קטן למספרים. יותר מקום ליצירה.</h3><p>חומרי גלם ← מתכוני משנה ← מנות ותמחור. כל הנתונים נשמרים במכשיר שלך.</p></div><button class="text-button" data-action="demo">טעינת דוגמה</button></section>` : ''}`;
}
function recipeCard(r) {
  const c = safeCost(r), valid = !c.errors.length, p = valid ? pricing(c.perOutput,r,data.settings) : null, sub = r.kind === 'subrecipe';
  const status = !valid ? 'חסר מידע' : p.actual?.gt(p.target) ? 'מעל היעד' : p.actual ? 'בתוך היעד' : sub ? 'מוכן לשימוש' : 'מוכן לתמחור';
  return `<button class="recipe-card" data-action="detail" data-id="${esc(r.id)}"><div class="card-top"><span class="dish-symbol">${icon(sub ? 'CookingPot' : 'Utensils')}</span><span class="badge ${!valid || p.actual?.gt(p.target) ? 'warn' : 'good'}">${status}</span></div><span class="card-category">${esc(r.category || (sub ? 'מתכון משנה' : 'מנה'))}</span><h3>${esc(r.name)}</h3><span class="card-meta">${r.items.length} רכיבים <span>·</span> ${esc(r.outputQuantity)} ${sub ? units[r.outputUnit].label : 'מנות באצווה'}</span><div class="card-cost"><span>${sub ? `עלות ל${units[r.outputUnit].label}` : 'עלות למנה'}${!valid ? ' · חלקית' : ''}</span><strong>${money(c.perOutput, sub ? 3 : 2)}</strong></div><div class="card-bottom"><span>${sub ? 'צפייה בהרכב המתכון' : `Food Cost ${p?.actual ? pct(p.actual) : '—'}`}</span><span>${sub ? '' : r.sellingPrice ? money(r.sellingPrice) + ' לסועד' : 'טרם נקבע מחיר'} ${icon('ChevronLeft')}</span></div></button>`;
}
function ingredientCard(x) {
  let cost = null; try { cost = ingredientCost(x); } catch {}
  const base = x.purchaseUnit === 'kg' ? 'g' : x.purchaseUnit === 'l' ? 'ml' : x.purchaseUnit;
  return `<button class="recipe-card ingredient-card" data-action="edit-ingredient" data-id="${esc(x.id)}"><div class="card-top"><span class="dish-symbol olive">${icon('Wheat')}</span><span class="badge ${cost === null ? 'warn' : 'neutral'}">${cost === null ? 'חסר מחיר' : `ניצולת ${esc(x.yieldPercent)}%`}</span></div><span class="card-category">${esc(x.category || 'חומר גלם')}</span><h3>${esc(x.name)}</h3><span class="card-meta">${esc(x.purchaseQuantity)} ${units[x.purchaseUnit].label} באריזה · ${x.purchasePriceNet === '' ? 'ללא מחיר' : money(x.purchasePriceNet)}</span><div class="card-cost"><span>עלות ל${units[base].label} שימושי</span><strong>${money(cost, 3)}</strong></div><div class="card-bottom"><span>עדכון מחיר ${date(x.priceUpdatedAt)}</span>${icon('Pencil')}</div></button>`;
}
function field(label, name, value, extra = '') { return `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value)}" ${extra}></label>`; }
function options(selected, subset = Object.keys(units)) { return subset.map(u => `<option value="${u}" ${u === selected ? 'selected' : ''}>${units[u].label}</option>`).join(''); }
function settingsView() {
  const s = data.settings;
  return `<section class="page-heading"><div><div class="eyebrow">סביבת העבודה שלך</div><h1>הכול במקום בטוח.</h1><p>העדפות תמחור, שמירה מקומית ועותק לדרך.</p></div></section><section class="tutorial-entry"><span class="guide-icon">${icon('CircleHelp')}</span><div><h2>איך משתמשים בכרם?</h2><p>מדריך קצר, מחומרי הגלם ועד לתמחור ולגיבוי.</p></div><button class="secondary" data-action="tutorial-open">פתיחת המדריך ${icon('ArrowLeft')}</button></section><div class="settings-grid"><section class="panel"><div class="panel-title">${icon('Settings')}<h2>העדפות תמחור</h2></div><form id="settings-form"><div class="form-error" role="alert"></div><div class="fields two">${field('יעד Food Cost כללי (%)','target',s.target,'inputmode="decimal" required')}${field('עיגול מחיר מוצע כלפי מעלה (₪)','rounding',s.rounding,'inputmode="decimal" required')}</div><label class="field"><span>מחירי המכירה לסועד</span><select name="sellingBasis"><option value="net" ${s.sellingBasis === 'net' ? 'selected' : ''}>לפני מס</option><option value="gross" ${s.sellingBasis === 'gross' ? 'selected' : ''}>כולל מס</option></select></label>${field('שיעור מס שהגדרת (%)','taxRate',s.taxRate,'inputmode="decimal" required')}<p class="hint">עלויות חומרי גלם מוזנות לפני מס. שינוי בסיס המחיר ימיר מחירים קיימים תוך שמירה על ערכם לפני מס.</p><button class="primary" type="submit">${icon('Check')}שמירת העדפות</button></form></section><section class="panel"><div class="panel-title">${icon('ShieldCheck')}<h2>גיבוי ושחזור</h2></div><p>הנתונים נשמרים בדפדפן במכשיר הזה. קובץ גיבוי מאפשר לשחזר אותם או להעביר אותם לטלפון אחר.</p><div class="backup-date"><span>קובץ גיבוי אחרון שנוצר</span><strong>${date(data.meta.exportedAt)}</strong></div><button class="primary full" data-action="export">${icon('Download')}יצירת גיבוי JSON</button><button class="secondary full" data-action="import">${icon('Upload')}שחזור מקובץ גיבוי</button><input type="file" id="backup-file" accept=".json,application/json" hidden><p class="hint">שחזור מחליף את כל הנתונים הקיימים. הקובץ מכיל את מחירי הרכש והמתכונים שלך; שמרי אותו במקום מתאים.</p></section><section class="panel full-span"><div class="panel-title">${icon('Leaf')}<h2>אפליקציה קטנה, עצמאות מלאה</h2></div><div class="info-columns"><div><h3>גם בלי אינטרנט</h3><p>${offlineReady ? 'האפליקציה מוכנה לעבודה ללא רשת.' : 'הכנה לעבודה ללא רשת תושלם לאחר הפרסום וטעינה מוצלחת.'} הוספה למסך הבית זמינה דרך תפריט הדפדפן.</p></div><div><h3>המידע במכשיר שלך</h3><p>אין חשבון משתמש ואין סנכרון. ניקוי נתוני האתר עלול למחוק את המידע, ולכן כדאי ליצור גיבוי באופן קבוע.</p><button class="text-button" data-action="persist">בקשת אחסון מתמיד ${icon('ArrowLeft')}</button></div><div><h3>מה העלות כוללת?</h3><p>חומרי גלם בלבד. היתרה ממחיר המכירה אינה רווח נקי ואינה כוללת עבודה, תקורות והוצאות נוספות.</p></div></div></section></div>`;
}
function drawTutorial() {
  const step = tutorialSteps[tutorialIndex];
  const last = tutorialIndex === tutorialSteps.length - 1;
  showDialog(`${dialogHead('ברוכה הבאה לכרם', 'ארבעה צעדים קצרים בדרך למנה מתומחרת')}
    <div class="dialog-body tutorial-body">
      <ol class="tutorial-progress" aria-label="שלבי המדריך">${tutorialSteps.map((s, i) => `<li ${i === tutorialIndex ? 'aria-current="step"' : ''} class="${i <= tutorialIndex ? 'reached' : ''}"><span>${i + 1}</span><span class="sr-only">${esc(s.title)}</span></li>`).join('')}</ol>
      <span class="tutorial-symbol">${icon(step.icon)}</span>
      <p class="tutorial-counter">שלב ${tutorialIndex + 1} מתוך ${tutorialSteps.length}</p>
      <h3 id="tutorial-step-title" tabindex="-1">${esc(step.title)}</h3>
      <p class="tutorial-description">${esc(step.description)}</p>
      <div class="tutorial-example">${step.example.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
      <p class="tutorial-tip">${icon('CircleHelp')}<span>${esc(step.tip)}</span></p>
    </div>
    <div class="dialog-footer tutorial-footer">
      <button class="text-button" data-action="tutorial-finish">${last ? 'סגירה' : 'אדלג בינתיים'}</button>
      <div><button class="secondary" data-action="tutorial-back" ${tutorialIndex === 0 ? 'disabled' : ''}>הקודם</button>
      <button class="primary" data-action="${last ? 'tutorial-finish' : 'tutorial-next'}">${last ? 'הבנתי, אפשר להתחיל' : 'הבא'} ${icon(last ? 'Check' : 'ArrowLeft')}</button></div>
    </div>`);
  const modal = document.querySelector('#modal');
  modal.classList.add('tutorial-dialog');
  modal.scrollTop = 0;
  modal.querySelector('#tutorial-step-title').focus({ preventScroll: true });
}
async function finishTutorial() {
  let storageError = false;
  try {
    await completeTutorial();
  } catch {
    storageError = true;
  } finally {
    tutorialIndex = null;
    document.querySelector('#modal')?.close();
  }
  if (storageError) toast('הבחירה לא נשמרה במכשיר. ייתכן שהמדריך יופיע שוב בכניסה הבאה', true);
}
function showDialog(html, wide = false) {
  const modal = document.querySelector('#modal'); modal.className = wide ? 'wide' : ''; modal.innerHTML = html; const title=modal.querySelector('h2'); if(title){title.id='dialog-title';modal.setAttribute('aria-labelledby','dialog-title');}
  if (!modal.open) modal.showModal(); refreshIcons();
}
function dialogHead(title, sub = '') { return `<div class="dialog-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div><button class="icon-button" data-action="close" aria-label="סגירה">${icon('X')}</button></div>`; }
function newEditor(type, id) {
  const source = id ? (type === 'ingredient' ? data.ingredients : data.recipes).find(x => x.id === id) : null;
  detailId = null;
  editor = { type, record: source ? structuredClone(source) : type === 'ingredient' ? { id: crypto.randomUUID(), revision: 0, name:'', category:'', supplierName:'', purchaseQuantity:'1', purchaseUnit:'kg', purchasePriceNet:'', yieldPercent:'100', zeroConfirmed:false } : { id:crypto.randomUUID(), revision:0, name:'', category:'', kind:type, outputQuantity:'1', outputUnit:type === 'dish' ? 'portion' : 'g', items:[], targetOverride:'', sellingPrice:'', notes:'' } };
  dirty = false; drawEditor();
}
function drawEditor() {
  const r = editor.record, ingredient = editor.type === 'ingredient', sub = editor.type === 'subrecipe';
  let body;
  if (ingredient) body = `<div class="fields two">${field('שם חומר הגלם','name',r.name,'required maxlength="120"')}${field('קטגוריה','category',r.category,'maxlength="60"')}${field('כמות באריזה','purchaseQuantity',r.purchaseQuantity,'inputmode="decimal" required')}<label class="field"><span>יחידת אריזה</span><select name="purchaseUnit">${options(r.purchaseUnit)}</select></label>${field('מחיר אריזה לפני מס (₪)','purchasePriceNet',r.purchasePriceNet,'inputmode="decimal" placeholder="אפשר להשלים בהמשך"')}${field('ניצולת שימושית (%)','yieldPercent',r.yieldPercent,'inputmode="decimal" required')}</div><label class="checkbox"><input type="checkbox" name="zeroConfirmed" ${r.zeroConfirmed ? 'checked' : ''}> מחיר אפס מכוון (למשל מים)</label>${field('ספק (לא חובה)','supplierName',r.supplierName,'maxlength="120"')}<p class="hint">הכמויות במתכונים יהיו לאחר ניקוי וקילוף. ניצולת 80% פירושה שמאריזת ק״ג מתקבלים 800 גרם שימושיים.</p><div class="editor-preview" id="cost-preview"></div>`;
  else body = `<div class="fields two">${field('שם '+(sub ? 'מתכון המשנה' : 'המנה'),'name',r.name,'required maxlength="120"')}${field('קטגוריה','category',r.category,'maxlength="60"')}${field(sub ? 'תפוקה סופית שימושית' : 'מספר מנות באצווה','outputQuantity',r.outputQuantity,'inputmode="decimal" required')}${sub ? `<label class="field"><span>יחידת תפוקה</span><select name="outputUnit">${options(r.outputUnit)}</select></label>` : '<div class="field-note">כל הכמויות בהמשך מתייחסות לאצווה כולה.</div>'}</div><div class="section-label"><h3>הרכב ${sub ? 'המתכון' : 'המנה'}</h3><span>${r.items.length} רכיבים</span></div><div class="editor-rows">${r.items.map((row,i) => {
    const comp = (row.type === 'ingredient' ? data.ingredients : data.recipes).find(x => x.id === row.componentId);
    const unit = row.type === 'ingredient' ? comp?.purchaseUnit : comp?.outputUnit;
    return `<div class="component-row"><div><strong>${esc(comp?.name || 'רכיב חסר')}</strong><small>${row.type === 'recipe' ? 'מתכון משנה' : 'חומר גלם'}</small></div><label><span class="sr-only">כמות ${esc(comp?.name)}</span><input name="qty-${i}" value="${esc(row.quantity)}" inputmode="decimal" required></label><select name="unit-${i}" aria-label="יחידה ${esc(comp?.name)}">${options(row.unit, Object.keys(units).filter(u => units[u].family === units[unit]?.family))}</select><button type="button" class="icon-button danger" data-action="remove-row" data-index="${i}" aria-label="הסרת ${esc(comp?.name)}">${icon('X')}</button></div>`;
  }).join('') || '<p class="hint">הוסיפי חומר גלם או מתכון משנה כדי להתחיל לחשב.</p>'}</div><div class="add-component"><select id="component-picker" aria-label="בחירת רכיב"><option value="">בחירת רכיב להוספה…</option><optgroup label="חומרי גלם">${data.ingredients.filter(x => !x.archivedAt).sort((a,b)=>a.name.localeCompare(b.name,'he')).map(x => `<option value="ingredient:${esc(x.id)}">${esc(x.name)}</option>`).join('')}</optgroup><optgroup label="מתכוני משנה">${data.recipes.filter(x => x.kind === 'subrecipe' && !x.archivedAt && x.id !== r.id).map(x => `<option value="recipe:${esc(x.id)}">${esc(x.name)}</option>`).join('')}</optgroup></select><button type="button" class="secondary" data-action="add-row">${icon('Plus')}הוספה</button></div>${!data.ingredients.length ? '<p class="hint">כדי להתחיל, סגרי את הטופס והוסיפי חומרי גלם בלשונית המזווה.</p>' : ''}<div class="editor-preview" id="cost-preview"></div>${!sub ? `<div class="section-label"><h3>תמחור</h3></div><div class="fields two">${field('יעד Food Cost ייחודי (%)','targetOverride',r.targetOverride,`inputmode="decimal" placeholder="היעד הכללי: ${esc(data.settings.target)}%"`)}${field(`מחיר קיים לסועד (₪, ${data.settings.sellingBasis === 'gross' ? 'כולל מס' : 'לפני מס'})`,'sellingPrice',r.sellingPrice,'inputmode="decimal" placeholder="לא חובה"')}</div>` : ''}<label class="field"><span>הערות הכנה</span><textarea name="notes" rows="3" maxlength="4000">${esc(r.notes)}</textarea></label>`;
  showDialog(`${dialogHead(r.revision ? 'עריכת '+(ingredient ? 'חומר גלם' : sub ? 'מתכון משנה' : 'מנה') : 'הוספת '+(ingredient ? 'חומר גלם' : sub ? 'מתכון משנה' : 'מנה'), 'נשמר במכשיר שלך, זמין גם ללא רשת')}<form id="editor-form"><div class="dialog-body"><div class="form-error" role="alert"></div>${body}${r.revision ? `<div id="delete-feedback" class="delete-feedback" role="alert" tabindex="-1" hidden></div><div class="record-actions"><button type="button" class="text-button" data-action="archive">${icon('Archive')}${r.archivedAt ? 'הוצאה מארכיון' : 'העברה לארכיון'}</button><button type="button" class="text-button danger" data-action="delete">${icon('Trash2')}מחיקה</button></div>` : ''}</div><div class="dialog-footer"><span id="save-state">${dirty ? 'שינויים שלא נשמרו' : r.revision ? 'נשמר במכשיר' : 'פריט חדש'}</span><button type="button" class="secondary" data-action="close">ביטול</button><button type="submit" class="primary">${icon('Check')}שמירה</button></div></form>`, !ingredient);
  updatePreview();
}
function collectEditor() {
  const form = document.querySelector('#editor-form'); if (!form || !editor) return;
  const f = new FormData(form), r = editor.record;
  const fields = editor.type === 'ingredient' ? ['name','category','supplierName','purchaseQuantity','purchaseUnit','purchasePriceNet','yieldPercent'] : ['name','category','outputQuantity','notes', ...(r.kind === 'dish' ? ['targetOverride','sellingPrice'] : ['outputUnit'])];
  for (const key of fields) r[key] = String(f.get(key) ?? '').trim();
  if (editor.type === 'ingredient') r.zeroConfirmed = f.has('zeroConfirmed');
  else r.items.forEach((row,i) => { row.quantity = String(f.get(`qty-${i}`) ?? ''); row.unit = String(f.get(`unit-${i}`) ?? row.unit); });
}
function updatePreview() {
  const el = document.querySelector('#cost-preview'); if (!el || !editor) return;
  try {
    const r = editor.record;
    if (editor.type === 'ingredient') { const cost = ingredientCost(r); const base = r.purchaseUnit === 'kg' ? 'g' : r.purchaseUnit === 'l' ? 'ml' : r.purchaseUnit; el.innerHTML = `<span>עלות ל${units[base].label} שימושי</span><strong>${money(cost,3)}</strong>`; }
    else { const c = safeCost(r); el.innerHTML = `<div><span>עלות האצווה${c.errors.length ? ' · חלקית' : ''}</span><strong>${money(c.total)}</strong></div><div><span>עלות ל${r.kind === 'dish' ? 'מנה' : units[r.outputUnit]?.label}</span><strong>${money(c.perOutput,r.kind === 'dish' ? 2 : 3)}</strong></div>${c.errors.length ? `<small>${esc(c.errors[0])}</small>` : ''}`; }
  } catch (e) { el.innerHTML = `<span>${esc(e.message)}</span>`; }
}
function drawDetail(id) {
  const r = data.recipes.find(x => x.id === id); if (!r) { detailId = null; return; }
  const c = safeCost(r), sub = r.kind === 'subrecipe', valid = !c.errors.length, p = valid ? pricing(c.perOutput,r,data.settings) : null;
  showDialog(`${dialogHead(r.name, `${r.category || (sub ? 'מתכון משנה' : 'מנה')} · ${r.outputQuantity} ${sub ? units[r.outputUnit].label : 'מנות באצווה'}`)}<div class="dialog-body"><div class="detail-actions"><button class="secondary" data-action="edit-recipe" data-id="${esc(id)}">${icon('Pencil')}עריכה</button><button class="text-button" data-action="duplicate" data-id="${esc(id)}">${icon('Copy')}שכפול</button></div>${!valid ? `<div class="notice error"><strong>חסר מידע לתמחור מלא</strong><ul>${c.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}<div class="cost-hero"><span>עלות חומרי גלם ל${sub ? units[r.outputUnit].label : 'מנה'}${valid ? '' : ' · חלקית'}</span><strong>${money(c.perOutput,sub ? 3 : 2)}</strong><small>עלות האצווה: ${money(c.total)}</small></div>${!sub && p ? `<div class="pricing-grid"><div class="price-box"><span>מחיר מוצע לפי יעד ${pct(p.target)}</span><strong>${money(p.rounded)}</strong><small>לפני עיגול: ${money(p.suggested)}</small><small>Food Cost במחיר המעוגל: ${pct(p.roundedPercent)}</small></div><div class="price-box"><span>בדיקת מחיר קיים</span><strong>${r.sellingPrice ? money(r.sellingPrice) : 'טרם הוזן'}</strong><small>Food Cost בפועל: ${pct(p.actual)}</small>${p.actual ? `<small class="${p.actual.gt(p.target) ? 'warning-text' : 'success-text'}">${p.actual.gt(p.target) ? 'מעל היעד' : 'בתוך היעד'} · פער ${pct(p.actual.sub(p.target).abs()).replace('%','')} נקודות אחוז</small>` : ''}</div></div><p class="hint">מחירי המכירה ${data.settings.sellingBasis === 'gross' ? `כוללים מס בשיעור ${esc(data.settings.taxRate)}%` : 'לפני מס'}. יתרה לאחר חומרי גלם: ${money(p.remainder)} לפני מס. אינה רווח נקי.</p>` : ''}<div class="section-label"><h3>הרכב ועלויות</h3><span>לכל האצווה</span></div><div class="cost-lines">${c.rows.map(row => `<div><span><strong>${esc(row.name)}</strong><small>${esc(row.quantity)} ${units[row.unit]?.label || ''}</small></span><b>${money(row.cost)}</b></div>`).join('')}</div>${r.notes ? `<div class="notes"><h3>הערות הכנה</h3><p>${esc(r.notes)}</p></div>` : ''}${sub ? `<div class="notes"><h3>בשימוש אצל</h3><p>${esc(dependents(r.id,'recipe',data.recipes).map(x=>x.name).join(' · ') || 'עדיין לא בשימוש')}</p></div>` : ''}</div>`,true);
}
async function closeModal() {
  if (tutorialIndex !== null) return finishTutorial();
  if (dirty && !(await confirmAction('לצאת בלי לשמור?', 'השינויים בטופס הזה לא נשמרו. אפשר לחזור לעריכה או להשליך אותם.', 'השלכת שינויים'))) return;
  editor = null; detailId = null; pendingRestore = null; dirty = false; document.querySelector('#modal')?.close();
}
function confirmAction(title, description, button = 'אישור') {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'confirm-dialog';
    dialog.innerHTML = `<div class="dialog-body"><h2>${esc(title)}</h2><p>${esc(description)}</p></div><div class="dialog-footer"><button class="secondary" data-confirm="no">חזרה</button><button class="primary" data-confirm="yes">${esc(button)}</button></div>`;
    document.body.append(dialog); dialog.showModal();
    const done = value => { dialog.close(); dialog.remove(); resolve(value); };
    dialog.addEventListener('click',e => { const b = e.target.closest('[data-confirm]'); if (b) done(b.dataset.confirm === 'yes'); });
    dialog.addEventListener('cancel',e => {e.preventDefault(); done(false);});
  });
}
async function doExport() {
  const snapshot = await exportBackup(), blob = new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}), url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `food-cost-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),10000);
  await markExport(snapshot.dataRevision); toast('קובץ הגיבוי נוצר והועבר להורדה');
  data=await readData(); if(!pendingRestore) render();
}
async function loadDemo() {
  if (!(await confirmAction('להוסיף נתוני דוגמה?', 'יתווספו חומרי גלם, מתכון משנה ומנה לדוגמה. אפשר לערוך או למחוק אותם בהמשך.', 'הוספת דוגמה'))) return;
  const now = new Date().toISOString(), id = () => crypto.randomUUID();
  const tomatoes = { id:id(),revision:0,name:'עגבניות שרי',category:'ירקות',purchaseQuantity:'1',purchaseUnit:'kg',purchasePriceNet:'18',yieldPercent:'95',zeroConfirmed:false,priceUpdatedAt:now };
  const cheese = { id:id(),revision:0,name:'גבינת עיזים',category:'מוצרי חלב',purchaseQuantity:'500',purchaseUnit:'g',purchasePriceNet:'42',yieldPercent:'100',zeroConfirmed:false,priceUpdatedAt:now };
  const oil = { id:id(),revision:0,name:'שמן זית',category:'מזווה',purchaseQuantity:'1',purchaseUnit:'l',purchasePriceNet:'48',yieldPercent:'100',zeroConfirmed:false,priceUpdatedAt:now };
  const dressing = { id:id(),revision:0,kind:'subrecipe',name:'שמן עגבניות ליקב',category:'רטבים',outputQuantity:'250',outputUnit:'ml',items:[{type:'ingredient',componentId:oil.id,quantity:'200',unit:'ml'},{type:'ingredient',componentId:tomatoes.id,quantity:'150',unit:'g'}],notes:'למעוך בעדינות, לערבב ולסנן. למדוד תפוקה סופית.',targetOverride:'',sellingPrice:'' };
  const dish = { id:id(),revision:0,kind:'dish',name:'סלט שרי וגבינת עיזים',category:'מנות פתיחה',outputQuantity:'1',outputUnit:'portion',items:[{type:'ingredient',componentId:tomatoes.id,quantity:'220',unit:'g'},{type:'ingredient',componentId:cheese.id,quantity:'70',unit:'g'},{type:'recipe',componentId:dressing.id,quantity:'25',unit:'ml'}],targetOverride:'30',sellingPrice:data.settings.sellingBasis === 'gross' ? number('48').mul(number(data.settings.taxRate).div(100).add(1)).toString() : '48',notes:'להגיש לצד לחם טרי.' };
  await db.transaction('rw',db.tables,async()=>{for(const x of [tomatoes,cheese,oil]) await saveRecord('ingredients',x); await saveRecord('recipes',dressing); await saveRecord('recipes',dish);});
  toast('נתוני הדוגמה נוספו. הכול ניתן לעריכה'); await refresh();
}
function showDeleteFeedback(refs, message = 'המחיקה לא בוצעה') {
  const panel = document.querySelector('#delete-feedback');
  if (!panel) return toast(message, true);
  panel.hidden = false;
  panel.innerHTML = refs.length
    ? `<strong>לא ניתן למחוק — הפריט עדיין בשימוש</strong>
       <p>המנות ומתכוני המשנה הבאים תלויים בפריט, ישירות או דרך מתכון משנה:</p>
       <ul>${refs.map(r => `<li><strong>${esc(r.name)}</strong><span>${r.kind === 'dish' ? 'מנה' : 'מתכון משנה'}${r.archivedAt ? ' · בארכיון' : ''}</span></li>`).join('')}</ul>
       <p>למחיקה, הסירי את הפריט מהמתכונים שבהם הוא רכיב ושמרי אותם. אפשר גם להעביר אותו לארכיון כדי להסתירו מבחירה חדשה ולשמור על חישובי המנות הקיימות.</p>
       <button type="button" class="secondary" data-action="archive">${icon('Archive')}העברה לארכיון במקום מחיקה</button>`
    : `<strong>המחיקה לא בוצעה</strong><p>${esc(message)}</p>`;
  refreshIcons();
  panel.focus({ preventScroll: true });
  panel.scrollIntoView({ block: 'nearest', behavior: 'auto' });
}
const actions = {
  'tutorial-open': () => { tutorialIndex = 0; drawTutorial(); },
  'tutorial-next': () => { if (tutorialIndex < tutorialSteps.length - 1) { tutorialIndex++; drawTutorial(); } },
  'tutorial-back': () => { if (tutorialIndex > 0) { tutorialIndex--; drawTutorial(); } },
  'tutorial-finish': finishTutorial,
  new: () => newEditor(route === 'ingredients' ? 'ingredient' : route === 'subrecipes' ? 'subrecipe' : 'dish'),
  'edit-ingredient': id => newEditor('ingredient',id),
  detail: id => { detailId=id; drawDetail(id); },
  'edit-recipe': id => newEditor(data.recipes.find(x=>x.id===id).kind,id),
  close: closeModal,
  'add-row': () => { collectEditor(); const value = document.querySelector('#component-picker').value; if (!value) return toast('יש לבחור רכיב',true); const [type, componentId] = value.split(':'); const comp = (type === 'ingredient' ? data.ingredients : data.recipes).find(x=>x.id===componentId); const row = {type,componentId,quantity:'1',unit:type==='ingredient'?comp.purchaseUnit:comp.outputUnit}; const candidate = {...editor.record,items:[...editor.record.items,row]}; try { validateRecipe({...candidate,name:candidate.name || 'טיוטה'},data.recipes,data.ingredients); } catch(e) { return toast(e.message,true); } editor.record.items.push(row); dirty=true; drawEditor(); },
  'remove-row': (_,el) => { collectEditor(); editor.record.items.splice(Number(el.dataset.index),1); dirty=true; drawEditor(); },
  duplicate: id => { const source = data.recipes.find(x=>x.id===id); newEditor(source.kind,id); editor.record.id=crypto.randomUUID(); editor.record.revision=0; editor.record.name='עותק של '+source.name; editor.record.archivedAt=null; dirty=true; drawEditor(); },
  archive: async () => { const table = editor.type === 'ingredient' ? 'ingredients' : 'recipes'; const original = data[table].find(x=>x.id===editor.record.id); const refs=dependents(original.id,table==='ingredients'?'ingredient':'recipe',data.recipes); if (!(await confirmAction(original.archivedAt ? 'להחזיר מהארכיון?' : 'להעביר לארכיון?',refs.length ? `הפריט ימשיך להשתתף בחישוב ${refs.length} מתכונים ומנות קיימים. עריכות שלא נשמרו בטופס לא ייכללו.` : 'הפריט יוסתר מבחירה חדשה. עריכות שלא נשמרו בטופס לא ייכללו.'))) return; await saveRecord(table,{...original,archivedAt:original.archivedAt ? null : new Date().toISOString()}); editor=null; dirty=false; await refresh(); toast('הארכיון עודכן'); },
  delete: async () => {
    const table = editor.type === 'ingredient' ? 'ingredients' : 'recipes';
    const record = editor.record;
    const type = table === 'ingredients' ? 'ingredient' : 'recipe';
    const fresh = await readData();
    const refs = dependents(record.id, type, fresh.recipes);
    if (refs.length) return showDeleteFeedback(refs);
    if (!(await confirmAction('למחוק את הפריט?', `הפריט ״${record.name}״ יימחק לצמיתות. ניתן לשחזר רק מגיבוי.`, 'מחיקה'))) return;
    try {
      await removeRecord(table, record.id, record.revision);
    } catch (error) {
      // A different tab may add a dependency after the initial check.
      const latest = await readData();
      return showDeleteFeedback(dependents(record.id, type, latest.recipes), error.message);
    }
    editor = null;
    dirty = false;
    await refresh();
    toast('הפריט נמחק');
  },
  export: doExport,
  import: () => document.querySelector('#backup-file').click(),
  'cancel-restore': () => {pendingRestore=null; document.querySelector('#modal').close();},
  'confirm-restore': async () => { const pending=pendingRestore; if(!pending) return; await restoreBackup(pending.input,pending.revision); pendingRestore=null; document.querySelector('#modal').close(); await refresh(); toast('הגיבוי שוחזר בהצלחה'); },
  demo: loadDemo,
  persist: async () => { const granted = await navigator.storage?.persist?.(); toast(granted ? 'הדפדפן אישר אחסון מתמיד. עדיין מומלץ לגבות' : 'לא ניתן לאשר אחסון מתמיד בדפדפן הזה. אפשר להמשיך ולגבות כרגיל'); },
  update: async () => { if(dirty && !(await confirmAction('לטעון גרסה חדשה?', 'השינויים שלא נשמרו בטופס יאבדו.', 'טעינת הגרסה'))) return; dirty=false; registration.waiting?.postMessage({type:'SKIP_WAITING'}); }
};
document.addEventListener('click',async e=>{ const button=e.target.closest('[data-action]'); if(!button) return; const action=actions[button.dataset.action]; if(!action) return; button.disabled=true; try {await action(button.dataset.id,button);} catch(error){toast(error.message || 'הפעולה נכשלה. הנתונים לא אופסו',true);} finally{button.disabled=false;} });
document.addEventListener('input',e=>{
  if(e.target.closest('#settings-form')) dirty=true;
  if(e.target.closest('#editor-form')) {dirty=true; collectEditor(); document.querySelector('#save-state').textContent='שינויים שלא נשמרו'; updatePreview();}
  if(e.target.id==='search') {query=e.target.value; render(); document.querySelector('#search').focus();}
});
document.addEventListener('change',async e=>{
  if(e.target.id==='archive-filter') {showArchive=e.target.checked;render();}
  if(e.target.id==='category-filter') {category=e.target.value;render();}
  if(e.target.closest('#editor-form')) {dirty=true;collectEditor();updatePreview();}
  if(e.target.id==='backup-file') {
    try {
      const file=e.target.files[0]; if(!file) return;
      if(file.size>10*1024*1024) throw new Error('הקובץ גדול מדי. הגודל המרבי הוא 10MB');
      const input=JSON.parse(await file.text()), validated=validateBackup(input); pendingRestore={input,revision:data.meta.dataRevision || 0};
      showDialog(`${dialogHead('שחזור מגיבוי')}<div class="dialog-body"><div class="notice error">השחזור יחליף את כל הנתונים במכשיר הזה.</div><p>בקובץ: <strong>${validated.ingredients.length}</strong> חומרי גלם ו־<strong>${validated.recipes.length}</strong> מתכונים ומנות.</p><p>מועד יצוא: ${input.exportedAt && !isNaN(new Date(input.exportedAt)) ? date(input.exportedAt) : 'לא ידוע'}</p><p>מומלץ ליצור גיבוי לנתונים הקיימים לפני ההחלפה.</p><button class="secondary" data-action="export">${icon('Download')}גיבוי הנתונים הקיימים</button></div><div class="dialog-footer"><button class="secondary" data-action="cancel-restore">ביטול</button><button class="primary" data-action="confirm-restore">החלפת הנתונים ושחזור</button></div>`);
    } catch(error) {toast(error instanceof SyntaxError ? 'הקובץ אינו JSON תקין. הנתונים לא שונו' : error.message,true);} finally {e.target.value='';}
  }
});
document.addEventListener('submit',async e=>{
  if(!['editor-form','settings-form'].includes(e.target.id)) return;
  e.preventDefault(); const form=e.target, button=form.querySelector('[type="submit"]'), errorEl=form.querySelector('.form-error'); errorEl.textContent=''; button.disabled=true;
  try {
    if(form.id==='editor-form') {
      collectEditor(); const r=editor.record, table=editor.type==='ingredient'?'ingredients':'recipes', fresh=await readData();
      if(editor.type==='ingredient') {
        validateIngredient(r);
        const previous=fresh.ingredients.find(x=>x.id===r.id);
        if(previous && previous.purchaseUnit!==r.purchaseUnit && dependents(r.id,'ingredient',fresh.recipes).length && units[previous.purchaseUnit].family!==units[r.purchaseUnit].family) throw new Error('חומר הגלם בשימוש. לא ניתן לשנות למשפחת יחידות אחרת');
        r.priceUpdatedAt=previous?.purchasePriceNet===r.purchasePriceNet ? previous.priceUpdatedAt : new Date().toISOString();
      } else validateRecipe(r,fresh.recipes,fresh.ingredients);
      const duplicate=fresh[table].some(x=>x.id!==r.id && x.name.trim()===r.name.trim());
      if(duplicate && !(await confirmAction('כבר קיים פריט בשם הזה', 'אפשר לשמור גרסה נוספת או לחזור ולשנות את השם.', 'שמירת פריט נוסף'))) return;
      const affected=dependents(r.id,table==='ingredients'?'ingredient':'recipe',fresh.recipes).length;
      await saveRecord(table,r); editor=null;dirty=false; await refresh(); toast(`נשמר במכשיר${affected ? ` · ${affected} מתכונים ומנות עודכנו` : ''}`);
    } else {
      const f=new FormData(form), settings=Object.fromEntries(f); validateSettings(settings);
      if((settings.sellingBasis!==data.settings.sellingBasis || settings.taxRate!==data.settings.taxRate) && !(await confirmAction('לעדכן את בסיס המחיר?', 'המחירים הקיימים יומרו תוך שמירה על מחירם לפני מס. החישוב משתמש בשיעור המס שהזנת.', 'המרה ושמירה'))) return;
      await saveSettings(settings,data.meta.dataRevision || 0); dirty=false; await refresh(); toast('ההעדפות נשמרו במכשיר');
    }
  } catch(error) {errorEl.textContent=error.message;errorEl.scrollIntoView({block:'nearest'});} finally {button.disabled=false;}
});
document.addEventListener('cancel',e=>{if(e.target.id==='modal'){e.preventDefault();closeModal();}},true);
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('hashchange',async()=>{if(editor || detailId || dirty) await closeModal(); if(editor || dirty) {history.replaceState(null,'',`#/${route}`);return;} pendingRestore=null;query='';category='';showArchive=false;setRoute();});
window.addEventListener('online',()=>{if(!dirty)render();}); window.addEventListener('offline',()=>{if(!dirty)render();});
function setRoute(){const next=location.hash.split('/')[1];route=['dishes','ingredients','subrecipes','settings'].includes(next)?next:'dishes';render();}
function showUpdateButton(){if(!document.querySelector('[data-action="update"]')){const b=document.createElement('button');b.className='update-button secondary';b.dataset.action='update';b.textContent='גרסה חדשה מוכנה · עדכון';document.querySelector('.topbar')?.append(b);}}
async function initWorker(){
  if(!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  try {
    registration=await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`,{scope:import.meta.env.BASE_URL});
    let reloading=false; const hadController=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController && !reloading && !dirty){reloading=true;location.reload();} else {offlineReady=true; if(!editor && !detailId) render();}});
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed' && navigator.serviceWorker.controller) showUpdateButton();});});
    const ready=await navigator.serviceWorker.ready; offlineReady=!!ready.active;
    if(!editor && !detailId) render(); if(registration.waiting) showUpdateButton();
  } catch {toast('הכנה לעבודה ללא רשת לא הושלמה. אפשר לנסות בטעינה הבאה',true);}
}
try {await refresh();setRoute();if(await shouldShowTutorial()){tutorialIndex=0;drawTutorial();}initWorker();} catch(error){app.innerHTML=`<main class="fatal"><h1>לא ניתן לפתוח את האחסון המקומי</h1><p>אפשר לנסות לפתוח את האתר בדפדפן רגיל ולוודא שאחסון אתרים מותר. הנתונים לא אופסו.</p><p>${esc(error.message)}</p><button onclick="location.reload()">ניסיון נוסף</button></main>`;}
