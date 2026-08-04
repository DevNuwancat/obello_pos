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

  // IMPORTANT: sort_order is only unique WITHIN a single size group (each
  // group restarts numbering at 0). So we sort the sizes INSIDE each group
  // first, then stack the groups one after another — we never sort across
  // groups together, otherwise a "Standard" S (sort_order 0) and an
  // "Oversized" 2XL (sort_order 0) would land next to each other and the
  // two templates would get shuffled into one messy list, e.g.
  // S, 2XL, M, 3XL, L, 4XL, XL, 5XL instead of S, M, L, XL, 2XL, 3XL, 4XL, 5XL.
  const values: string[] = []
  for (const row of (data || []) as unknown as LinkRow[]) {
    const group = row.size_groups
    if (!group || !group.is_active) continue
    const groupValues = [...(group.size_options || [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(o => o.value)
    values.push(...groupValues)
  }

  if (values.length === 0) return ['Free Size']

  return values
}
