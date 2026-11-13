/*
  invoiceFolder.ts — saves digital invoices into ONE folder on the computer.

  A website normally cannot choose where a file goes (it lands in Downloads).
  Chrome / Edge have a feature for this: the person picks a folder ONCE, we remember it,
  and from then on we can write files into it without asking again.

    1. chooseInvoiceFolder()  → shows the "pick a folder" window (must come from a click)
    2. saveInvoiceToFolder()  → inside that folder, makes (or re-uses) a folder called
                                "Digital Invoice Obello System" and puts  INV-xxxx.pdf  in it.
                                The file name is only the invoice number — no date.

  If the browser does not support it (Safari, Firefox) or nothing was chosen, the caller
  falls back to a normal download. Nothing here ever throws.
*/

export const INVOICE_FOLDER_NAME = 'Digital Invoice Obello System'

const DB_NAME = 'obello-invoice-folder'
const STORE = 'handles'
const KEY = 'root'

// The chosen folder is remembered in IndexedDB (the browser's small built-in database),
// because a folder "handle" cannot be saved in localStorage.
function openDb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => ok(req.result)
    req.onerror = () => fail(req.error)
  })
}
async function readRoot(): Promise<any | null> {
  try {
    const db = await openDb()
    return await new Promise((ok) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      r.onsuccess = () => ok(r.result ?? null)
      r.onerror = () => ok(null)
    })
  } catch { return null }
}
async function writeRoot(handle: any): Promise<void> {
  const db = await openDb()
  await new Promise<void>((ok, fail) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(handle, KEY)
    tx.oncomplete = () => ok()
    tx.onerror = () => fail(tx.error)
  })
}

/** Can this browser save into a chosen folder? (Chrome and Edge yes; Safari and Firefox no) */
export function canPickInvoiceFolder(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function'
}

/** Has a folder been chosen on this computer already? */
export async function hasInvoiceFolder(): Promise<boolean> {
  return (await readRoot()) !== null
}

/** Shows the "choose a folder" window. Call it straight from a click. Returns false if cancelled. */
export async function chooseInvoiceFolder(): Promise<boolean> {
  if (!canPickInvoiceFolder()) return false
  try {
    const handle = await (window as any).showDirectoryPicker({ id: 'obello-invoices', mode: 'readwrite', startIn: 'documents' })
    await writeRoot(handle)
    return true
  } catch {
    return false   // the person pressed Cancel (or the browser refused)
  }
}

/** Puts the PDF in  <chosen folder>/Digital Invoice Obello System/<fileName>. Returns false if it could not. */
export async function saveInvoiceToFolder(pdf: Blob, fileName: string): Promise<boolean> {
  const root = await readRoot()
  if (!root) return false
  try {
    // The browser may need to be asked again after it was closed ("allow on every visit")
    let permission = await root.queryPermission({ mode: 'readwrite' })
    if (permission !== 'granted') permission = await root.requestPermission({ mode: 'readwrite' })
    if (permission !== 'granted') return false

    // Folder exists → use it. Does not exist → create it. If the chosen folder already has this name, use it directly.
    const folder = root.name === INVOICE_FOLDER_NAME
      ? root
      : await root.getDirectoryHandle(INVOICE_FOLDER_NAME, { create: true })
    const file = await folder.getFileHandle(fileName, { create: true })   // same invoice number again → replaced
    const out = await file.createWritable()
    await out.write(pdf)
    await out.close()
    return true
  } catch (e) {
    console.warn('Could not save the invoice into the folder:', e)
    return false
  }
}
