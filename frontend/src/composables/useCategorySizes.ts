import { supabase } from '../lib/supabase'

// Row shape returned by the nested Supabase select below
type LinkRow = {
  size_groups: {
    is_active: boolean
    size_options: { value: string; sort_order: number }[]
  } | null
}

// Given a sub-category id (e.g. the "Oversize T-Shirt" row's id), returns
// every size option from every active size group linked to that sub-category
// — flattened and sorted. Falls back to ['Free Size'] if nothing is
// configured for it.
export async function fetchSizesForCategory(categoryId: string | undefined | null): Promise<string[]> {
  if (!categoryId) return ['Free Size']

  const { data, error } = await supabase
    .from('category_size_links')
    .select('size_groups(is_active, size_options(value, sort_order))')
    .eq('category_id', categoryId)
    .eq('is_active', true)

  if (error) {
    console.error('fetchSizesForCategory failed:', error.message)
    return ['Free Size']
  }

  const options: { value: string; sort_order: number }[] = []
  for (const row of (data || []) as unknown as LinkRow[]) {
    const group = row.size_groups
    if (!group || !group.is_active) continue
    options.push(...(group.size_options || []))
  }

  if (options.length === 0) return ['Free Size']

  return options
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(o => o.value)
}
