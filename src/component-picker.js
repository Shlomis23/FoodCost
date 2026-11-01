export function normalizedSearch(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/["'׳״]/g, '').toLocaleLowerCase('he').trim();
}
export function findComponents(data, query = '', excludedRecipeId) {
  const tokens = normalizedSearch(query).split(/\s+/).filter(Boolean);
  return [
    ...data.ingredients.filter(x => !x.archivedAt).map(record => ({ type: 'ingredient', record })),
    ...data.recipes.filter(x => x.kind === 'subrecipe' && !x.archivedAt && x.id !== excludedRecipeId).map(record => ({ type: 'recipe', record }))
  ].filter(({ record }) => {
    const searchable = normalizedSearch(`${record.name} ${record.category || ''}`);
    return tokens.every(token => searchable.includes(token));
  }).sort((a, b) => a.record.name.localeCompare(b.record.name, 'he'));
}
