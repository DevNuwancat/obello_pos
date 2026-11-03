// useCustomerTags.ts
//
// One shared place for customer TAGS ("location categories" such as
// "Provincial Council" or "Pradeshiya Sabha").
//
// The data lives at the top of this file (not inside the function), so every
// page and popup that calls useCustomerTags() sees the SAME tags — create a tag
// in the Customer Book and it is instantly there in Pay Later too.

import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'

export interface CustomerTag {
  id: string
  name: string
  color: string   // hex, e.g. '#8b5cf6'
}

// Colours to pick from when making a tag
export const TAG_COLORS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#64748b']

// Special filter value meaning "customers that have no tag at all"
export const NO_TAG = '__none__'

const tags   = ref<CustomerTag[]>([])
const links  = ref(new Map<string, string[]>())   // customer id → ids of their tags
const loaded = ref(false)
const loading = ref(false)

const tagById = computed(() => new Map(tags.value.map(t => [t.id, t])))

async function loadTags(force = false) {
  if (loading.value || (loaded.value && !force)) return
  loading.value = true
  try {
    const tagRes = await supabase.from('customer_tags').select('id, name, color').order('name')
    if (tagRes.error) { console.warn('Could not load tags:', tagRes.error.message); return }

    // Supabase returns at most 1000 rows per request, so ask page by page
    const map = new Map<string, string[]>()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('customer_tag_links').select('customer_id, tag_id').range(from, from + 999)
      if (error) { console.warn('Could not load tag links:', error.message); return }
      for (const l of data ?? []) {
        const list = map.get(l.customer_id) ?? []
        list.push(l.tag_id)
        map.set(l.customer_id, list)
      }
      if (!data || data.length < 1000) break
    }
    tags.value  = (tagRes.data ?? []) as CustomerTag[]
    links.value = map
    loaded.value = true
  } finally {
    loading.value = false
  }
}

// The tags of one customer (as full tag objects, in alphabetical order)
function tagsOf(customerId: string | null | undefined): CustomerTag[] {
  if (!customerId) return []
  return (links.value.get(customerId) ?? [])
    .map(id => tagById.value.get(id))
    .filter((t): t is CustomerTag => !!t)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function tagIdsOf(customerId: string): string[] {
  return [...(links.value.get(customerId) ?? [])]
}

// Does this customer pass the tag filter?  null = no filter · NO_TAG = has no tags
function matchesTag(customerId: string, filter: string | null): boolean {
  if (!filter) return true
  const ids = links.value.get(customerId) ?? []
  return filter === NO_TAG ? ids.length === 0 : ids.includes(filter)
}

// Lower-case tag names of a customer, for the search box ("provincial" finds the tag's people)
function tagSearchText(customerId: string): string {
  return tagsOf(customerId).map(t => t.name.toLowerCase()).join(' ')
}

// Ids of customers that carry a tag whose NAME contains the typed text (for searching by tag name)
function customerIdsWithTagText(text: string): string[] {
  const q = text.trim().toLowerCase()
  if (!q) return []
  const wanted = new Set(tags.value.filter(t => t.name.toLowerCase().includes(q)).map(t => t.id))
  const out: string[] = []
  for (const [cid, ids] of links.value) if (ids.some(id => wanted.has(id))) out.push(cid)
  return out
}

// How many customers carry each tag
const tagCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const ids of links.value.values()) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
})

async function createTag(name: string, color: string): Promise<{ tag?: CustomerTag; error?: string }> {
  const clean = name.trim()
  if (!clean) return { error: 'Type a tag name first' }
  const { data, error } = await supabase.from('customer_tags').insert({ name: clean, color }).select('id, name, color').single()
  if (error) {
    return { error: error.code === '23505' ? `The tag "${clean}" already exists` : error.message }
  }
  tags.value = [...tags.value, data as CustomerTag].sort((a, b) => a.name.localeCompare(b.name))
  return { tag: data as CustomerTag }
}

async function updateTag(id: string, name: string, color: string): Promise<string> {
  const clean = name.trim()
  if (!clean) return 'Type a tag name first'
  const { error } = await supabase.from('customer_tags').update({ name: clean, color }).eq('id', id)
  if (error) return error.code === '23505' ? `The tag "${clean}" already exists` : error.message
  tags.value = tags.value.map(t => t.id === id ? { ...t, name: clean, color } : t).sort((a, b) => a.name.localeCompare(b.name))
  return ''
}

// Deleting a tag also removes it from every customer (the database does that part)
async function deleteTag(id: string): Promise<string> {
  const { error } = await supabase.from('customer_tags').delete().eq('id', id)
  if (error) return error.message
  tags.value = tags.value.filter(t => t.id !== id)
  const next = new Map<string, string[]>()
  for (const [cid, ids] of links.value) {
    const kept = ids.filter(t => t !== id)
    if (kept.length) next.set(cid, kept)
  }
  links.value = next
  return ''
}

// Make the customer's tags exactly `wantedIds`: adds the new ones, removes the ones taken off
async function setCustomerTags(customerId: string, wantedIds: string[]): Promise<string> {
  const have = new Set(links.value.get(customerId) ?? [])
  const want = new Set(wantedIds)
  const toAdd    = [...want].filter(id => !have.has(id))
  const toRemove = [...have].filter(id => !want.has(id))

  if (toAdd.length) {
    const { error } = await supabase.from('customer_tag_links').insert(toAdd.map(tag_id => ({ customer_id: customerId, tag_id })))
    if (error) return error.message
  }
  if (toRemove.length) {
    const { error } = await supabase.from('customer_tag_links').delete().eq('customer_id', customerId).in('tag_id', toRemove)
    if (error) return error.message
  }
  const next = new Map(links.value)
  if (want.size) next.set(customerId, [...want]); else next.delete(customerId)
  links.value = next
  return ''
}

export function useCustomerTags() {
  return { tags, tagCounts, loaded, loadTags, tagsOf, tagIdsOf, matchesTag, tagSearchText, customerIdsWithTagText, createTag, updateTag, deleteTag, setCustomerTags }
}
