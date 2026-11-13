/*
  digitalInvoice.ts — makes the Obello digital invoice (a PDF) and downloads it.

  The look copies design/inovice_design/digital_invoice.pdf:
    • fonts  : Raleway (words) + JetBrains Mono (numbers, labels)
    • images : the Obello logo, the "Scan to Follow" QR code, social + contact icons
  All the pictures and fonts live in src/assets/invoice/.

  HOW THE LAYOUT WORKS
  The design was measured in "pixels" on an 827 x 1170 picture of an A4 page.
  We keep those same numbers below (so they are easy to compare with the design) and
  convert them to millimetres with  mm(px).  Fonts use  pt(px).
*/
import jsPDF from 'jspdf'
import { supabase } from './supabase'
import { saveInvoiceToFolder, INVOICE_FOLDER_NAME } from './invoiceFolder'

import logoUrl from '../assets/invoice/logo.png'
import qrUrl from '../assets/invoice/qr.png'
import pinUrl from '../assets/invoice/pin.png'
import phoneUrl from '../assets/invoice/phone.png'
import facebookUrl from '../assets/invoice/facebook.png'
import tiktokUrl from '../assets/invoice/tiktok.png'
import instagramUrl from '../assets/invoice/instagram.png'
import ralewayRegularUrl from '../assets/invoice/fonts/Raleway-Regular.ttf?url'
import ralewayBoldUrl from '../assets/invoice/fonts/Raleway-Bold.ttf?url'
import monoRegularUrl from '../assets/invoice/fonts/JetBrainsMono-Regular.ttf?url'
import monoBoldUrl from '../assets/invoice/fonts/JetBrainsMono-Bold.ttf?url'
import monoMediumUrl from '../assets/invoice/fonts/JetBrainsMono-Medium.ttf?url'

// ──────────────────────────────────────────────
// 1. THE DATA an invoice needs
// ──────────────────────────────────────────────
export interface InvoiceItem {
  name: string
  sku?: string | null
  /** 'Discount' | 'Super' | 'Original' (how the app saves it) or any text; shown as Promotional / Special / Regular */
  rate?: string | null
  qty: number
  unitPrice: number
  amount: number
  isGift?: boolean
}

export interface InvoiceCustomer {
  name?: string | null
  phone?: string | null
  address?: string | null
}

export interface InvoiceData {
  invoiceNo: string
  date: Date | string
  cashier?: string | null
  /** 'Cash' | 'Card' | 'Bank' | 'Later Pay' (or the database codes cash / card / bank / later_pay) */
  payment: string
  cancelled?: boolean
  customer?: InvoiceCustomer | null
  items: InvoiceItem[]
  subtotal: number
  discount: number     // money taken off the bill (0 if none)
  total: number
  paid: number
  balance?: number     // optional: if left out we work it out from total and paid
}

// ──────────────────────────────────────────────
// 2. SHOP DETAILS (printed at the bottom of every invoice)
// ──────────────────────────────────────────────
const SHOP = {
  address: 'Marapana-South, Ratnapura.',
  phone: '+94 75 314 9173',
  phoneLink: 'tel:+94753149173',
  email: 'obelloclothing@gmail.com',
  handle: '@obelloclothing',
  policy:
    'Exchange accepted within 7 days of purchase with the original invoice and unused merchandise in original condition. ' +
    'Exchange is subject to stock availability. Terms and conditions apply.',
}

// ──────────────────────────────────────────────
// 3. SMALL HELPERS
// ──────────────────────────────────────────────
const MM_PER_PX = 210 / 827           // the design picture is 827px wide = 210mm (A4)
const mm = (px: number) => px * MM_PER_PX
const pt = (px: number) => px * 0.72  // font size: design pixels → points

const INK  = '#000000'
const GREY = '#666666'
const LINE = '#bdbdbd'

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const two = (n: number) => String(n).padStart(2, '0')   // 1 → "01"

function payLabel(p: string): string {
  const key = (p || '').toLowerCase().replace(/\s+/g, '_')
  return ({ cash: 'Cash', card: 'Card', bank: 'Bank', later_pay: 'Later Pay', laterpay: 'Later Pay' } as Record<string, string>)[key] ?? p
}

// The app saves the price type as Discount / Super / Original. The invoice shows the customer-friendly words.
function rateLabel(r?: string | null, isGift?: boolean): string {
  if (isGift) return 'Free Gift'
  const k = (r || '').toLowerCase()
  if (k === 'discount' || k === 'promotional') return 'Promotional'
  if (k === 'super' || k === 'special') return 'Special'
  if (k === 'original' || k === 'regular') return 'Regular'
  return r || 'Regular'
}

// ──────────────────────────────────────────────
// 4. LOADING fonts + pictures (once, then remembered)
// ──────────────────────────────────────────────
async function fileToBase64(url: string): Promise<string> {
  const buf = await (await fetch(url)).arrayBuffer()
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function pictureToDataUrl(url: string): Promise<{ data: string; w: number; h: number }> {
  const blob = await (await fetch(url)).blob()
  const data: string = await new Promise((ok, fail) => {
    const r = new FileReader()
    r.onload = () => ok(r.result as string)
    r.onerror = () => fail(r.error)
    r.readAsDataURL(blob)
  })
  const size: { w: number; h: number } = await new Promise((ok, fail) => {
    const img = new Image()
    img.onload = () => ok({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => fail(new Error('Could not read invoice image'))
    img.src = data
  })
  return { data, ...size }
}

type Pic = { data: string; w: number; h: number }
interface Assets { fonts: Record<string, string>; pics: Record<string, Pic> }
let assetsPromise: Promise<Assets> | null = null

function loadAssets(): Promise<Assets> {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const [rr, rb, mr, mb, mm_] = await Promise.all([ralewayRegularUrl, ralewayBoldUrl, monoRegularUrl, monoBoldUrl, monoMediumUrl].map(fileToBase64))
      const names = ['logo', 'qr', 'pin', 'phone', 'facebook', 'tiktok', 'instagram']
      const list = await Promise.all([logoUrl, qrUrl, pinUrl, phoneUrl, facebookUrl, tiktokUrl, instagramUrl].map(pictureToDataUrl))
      const pics: Record<string, Pic> = {}
      names.forEach((n, i) => { pics[n] = list[i] })
      return { fonts: { rr, rb, mr, mb, mm: mm_ }, pics }
    })().catch(e => { assetsPromise = null; throw e })   // if it failed, try again next time
  }
  return assetsPromise
}

// ──────────────────────────────────────────────
// 5. DRAWING the PDF
// ──────────────────────────────────────────────
type FontName = 'Raleway' | 'Mono' | 'MonoMedium'   // MonoMedium = JetBrains Mono, a bit heavier (the grey labels)

export async function buildInvoicePdf(inv: InvoiceData): Promise<jsPDF> {
  const { fonts, pics } = await loadAssets()
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  doc.setProperties({ title: `Invoice ${inv.invoiceNo}`, author: 'Obello' })

  doc.addFileToVFS('Raleway-Regular.ttf', fonts.rr);  doc.addFont('Raleway-Regular.ttf', 'Raleway', 'normal')
  doc.addFileToVFS('Raleway-Bold.ttf', fonts.rb);     doc.addFont('Raleway-Bold.ttf', 'Raleway', 'bold')
  doc.addFileToVFS('JetBrainsMono-Regular.ttf', fonts.mr); doc.addFont('JetBrainsMono-Regular.ttf', 'Mono', 'normal')
  doc.addFileToVFS('JetBrainsMono-Bold.ttf', fonts.mb);    doc.addFont('JetBrainsMono-Bold.ttf', 'Mono', 'bold')
  doc.addFileToVFS('JetBrainsMono-Medium.ttf', fonts.mm); doc.addFont('JetBrainsMono-Medium.ttf', 'MonoMedium', 'normal')

  // — tiny drawing helpers (all positions are in design pixels) —
  function text(s: string, x: number, y: number, o: {
    font?: FontName; bold?: boolean; size?: number; color?: string; align?: 'left' | 'center' | 'right'
  } = {}) {
    doc.setFont(o.font ?? 'Raleway', o.bold ? 'bold' : 'normal')
    doc.setFontSize(pt(o.size ?? 14))
    doc.setTextColor(o.color ?? INK)
    doc.text(s, mm(x), mm(y), { align: o.align ?? 'left', baseline: 'middle' })
  }
  function lines(s: string, maxWidthPx: number, o: { font?: FontName; bold?: boolean; size?: number }): string[] {
    doc.setFont(o.font ?? 'Raleway', o.bold ? 'bold' : 'normal')
    doc.setFontSize(pt(o.size ?? 14))
    return doc.splitTextToSize(s, mm(maxWidthPx)) as string[]
  }
  function rule(y: number, x1 = 82, x2 = 744, dashed = false) {
    doc.setDrawColor(dashed ? LINE : INK)
    doc.setLineWidth(dashed ? 0.2 : 0.3)
    doc.setLineDashPattern(dashed ? [0.8, 0.7] : [], 0)
    doc.line(mm(x1), mm(y), mm(x2), mm(y))
    doc.setLineDashPattern([], 0)
  }
  function picture(name: string, x: number, y: number, wPx: number, hPx?: number) {
    const p = pics[name]
    const h = hPx ?? (wPx * p.h) / p.w
    doc.addImage(p.data, 'PNG', mm(x), mm(y), mm(wPx), mm(h))
  }
  function pageNumber(n: number, total: number) {
    if (total > 1) text(`Page ${n} of ${total}`, 744, 1150, { font: 'Mono', size: 11, color: GREY, align: 'right' })
  }

  // — numbers worked out once —
  const total = Number(inv.total) || 0
  const paid = Number(inv.paid) || 0
  const due = Math.max(0, total - paid)
  const change = Math.max(0, paid - total)
  const status = inv.cancelled ? 'Cancelled' : paid + 0.005 >= total ? 'Paid' : paid > 0 ? 'Part Paid' : 'Unpaid'
  const when = new Date(inv.date)
  const dateStr = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const timeStr = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const items = inv.items.filter(i => i.qty > 0)

  // ── The top of page 1: logo, INVOICE, details, customer ──
  function drawTop(): number {
    picture('logo', 78, 50, 248)
    text('INVOICE', 744, 98, { bold: true, size: 29, align: 'right' })
    text(inv.invoiceNo, 744, 126, { font: 'Mono', size: 16, color: GREY, align: 'right' })
    rule(155, 82, 744)

    // date · time · cashier · payment · status
    const label = (s: string, x: number, a: 'left' | 'center' | 'right' = 'left') =>
      text(s, x, 182, { font: 'MonoMedium', size: 15.5, color: GREY, align: a })
    const value = (s: string, x: number, a: 'left' | 'center' | 'right' = 'left') =>
      text(s, x, 207, { font: 'Mono', size: 14.5, align: a })
    label('DATE', 82);         value(dateStr, 82)
    label('TIME', 226);        value(timeStr, 226)
    label('CASHIER', 374);     value(inv.cashier || '—', 374)
    label('PAYMENT', 571, 'center'); value(payLabel(inv.payment), 571, 'center')
    label('STATUS', 744, 'right');   value(status, 744, 'right')
    rule(231, 82, 744, true)

    // customer · phone · address
    const c = inv.customer
    text('CUSTOMER', 82, 261, { font: 'MonoMedium', size: 15.5, color: GREY })
    text('PHONE', 290, 261, { font: 'MonoMedium', size: 15.5, color: GREY })
    text('ADDRESS', 744, 261, { font: 'MonoMedium', size: 15.5, color: GREY, align: 'right' })
    const nameLines = lines(c?.name || 'Walk-in customer', 180, { font: 'Mono', size: 14.5 }).slice(0, 2)
    nameLines.forEach((l, i) => text(l, 82, 287 + i * 17, { font: 'Mono', size: 14.5 }))
    text(c?.phone || '—', 290, 287, { font: 'Mono', size: 14.5 })
    const addr = lines(c?.address || '—', 330, { font: 'Mono', size: 14.5 }).slice(0, 2)
    addr.forEach((l, i) => text(l, 744, 287 + i * 17, { font: 'Mono', size: 14.5, align: 'right' }))
    return 337
  }

  // ── A smaller top for pages 2, 3, … ──
  function drawTopSmall(): number {
    picture('logo', 78, 40, 150)
    text('INVOICE', 744, 66, { bold: true, size: 22, align: 'right' })
    text(inv.invoiceNo, 744, 90, { font: 'Mono', size: 14, color: GREY, align: 'right' })
    return 150
  }

  // ── The table header (NO. ITEM RATE QTY UNIT PRICE AMOUNT) ──
  function drawTableHeader(y: number): number {
    rule(y, 82, 744)
    const h = (s: string, x: number, a: 'left' | 'center' | 'right', dy = 0) =>
      text(s, x, y + 19 + dy, { font: 'MonoMedium', size: 15, color: GREY, align: a })
    h('NO.', 82, 'left'); h('ITEM', 119, 'left')
    h('RATE', 431, 'center', -8); h('CATEGORY', 431, 'center', 8)
    h('QTY', 519, 'center')
    h('UNIT', 602, 'center', -8); h('PRICE', 602, 'center', 8)
    h('AMOUNT', 744, 'right')
    rule(y + 39, 82, 744)
    return y + 39
  }

  // ── One row of the table. Returns where the next row starts. ──
  const ROW_GAP = 70
  function rowHeight(it: InvoiceItem): number {
    return ROW_GAP + (lines(it.name, 258, { size: 13.6 }).length - 1) * 18
  }
  function drawRow(it: InvoiceItem, no: number, top: number): number {
    const nameLines = lines(it.name, 258, { size: 13.6 })
    const h = rowHeight(it)
    const mid = top + 28 + ((nameLines.length - 1) * 18) / 2   // middle of the row for the number columns
    nameLines.forEach((l, i) => text(l, 119, top + 28 + i * 18, { size: 13.6 }))
    text(it.sku || '', 119, top + 28 + nameLines.length * 18 - 2 + 2, { font: 'Mono', size: 12.5, color: GREY })
    text(two(no), 82, mid, { font: 'Mono', size: 15.5 })
    text(rateLabel(it.rate, it.isGift), 431, mid, { size: 13.6, align: 'center' })
    text(two(it.qty), 519, mid, { font: 'Mono', size: 15.5, align: 'center' })
    text(it.isGift ? '—' : money(it.unitPrice), 638, mid, { font: 'Mono', size: 15.5, align: 'right' })
    text(money(it.amount), 744, mid, { font: 'Mono', size: 15.5, align: 'right' })
    rule(top + h - 5, 82, 744, true)
    return top + h
  }

  // ── Totals block ──
  const showDiscount = Number(inv.discount) > 0.004
  const totalRows = (showDiscount ? 2 : 0) + 1 + 1 + 1     // [subtotal, discount] + total + paid + change/due
  const TOTALS_H = 18 + totalRows * 29 + (showDiscount ? 6 : 0)
  function drawTotals(top: number) {
    let y = top + 28
    const row = (name: string, value: number, o: { bold?: boolean; size?: number; grey?: boolean; minus?: boolean }) => {
      const c = o.grey ? GREY : INK
      text(name, 374, y, { bold: o.bold, size: o.size ?? 16.5, color: c })
      text('Rs.', 531, y, { font: 'Mono', size: o.size ?? 16, color: c })
      text((o.minus ? '- ' : '') + money(value), 744, y, { font: 'Mono', bold: o.bold, size: o.size ?? 16, color: c, align: 'right' })
      y += 29
    }
    if (showDiscount) {
      row('Subtotal', inv.subtotal, { grey: true })
      row('Discount', inv.discount, { grey: true, minus: true })
    }
    row('Total Payable', total, { bold: true, size: 18.5 })
    row('Amount Paid', paid, { grey: true })
    row(due > 0 ? 'Balance Due' : 'Change', due > 0 ? due : change, { grey: true })
  }

  // ── The bottom of the last page: policy, social, QR, thanks, contact ──
  function drawFooter() {
    rule(903, 82, 744, true)

    text('Exchange Policy :', 82, 930, { bold: true, size: 13.6 })
    lines(SHOP.policy, 530, { size: 13.2 }).forEach((l, i) => text(l, 82, 950 + i * 17.5, { size: 13.2, color: GREY }))

    picture('facebook', 82, 998, 23)
    picture('tiktok', 115, 998, 23)
    picture('instagram', 148, 998, 23)
    text('Follow & Tag obello', 84, 1031, { size: 9.5, color: GREY })
    text(SHOP.handle, 91, 1043, { bold: true, size: 9.5 })

    picture('qr', 641, 918, 102)    // the QR picture already has the "Scan to Follow" label under it

    text('Thank you for shopping with obello.', 411, 1071, { bold: true, size: 17, align: 'center' })
    rule(1091, 80, 742)

    // address · phone · email  (centered row)
    picture('pin', 164, 1108, 11.6)
    text(SHOP.address, 182, 1119, { size: 13 })
    picture('phone', 366, 1108, 17)
    doc.setFont('Raleway', 'normal'); doc.setFontSize(pt(13)); doc.setTextColor(INK)
    doc.textWithLink(SHOP.phone, mm(390), mm(1119), { url: SHOP.phoneLink, baseline: 'middle' })
    underline(SHOP.phone, 390, 1119, 13)
    // little envelope icon (drawn with lines)
    doc.setDrawColor(INK); doc.setLineWidth(0.3); doc.setLineDashPattern([], 0)
    doc.roundedRect(mm(511), mm(1110), mm(20), mm(15), mm(2), mm(2))
    doc.line(mm(512), mm(1112), mm(521), mm(1120)); doc.line(mm(530), mm(1112), mm(521), mm(1120))
    doc.setFont('Raleway', 'normal'); doc.setFontSize(pt(13))
    doc.textWithLink(SHOP.email, mm(538), mm(1119), { url: 'mailto:' + SHOP.email, baseline: 'middle' })
    underline(SHOP.email, 538, 1119, 13)
  }
  function underline(s: string, x: number, y: number, sizePx: number) {
    doc.setFont('Raleway', 'normal'); doc.setFontSize(pt(sizePx))
    const w = doc.getTextWidth(s)
    doc.setDrawColor(INK); doc.setLineWidth(0.2); doc.setLineDashPattern([], 0)
    doc.line(mm(x), mm(y + 7), mm(x) + w, mm(y + 7))
  }

  // ── PUTTING IT TOGETHER: place rows page by page ──
  const FOOTER_TOP = 903          // the dashed line above "Exchange Policy"
  const PAGE_LIMIT = 1120         // rows on a page that is NOT the last may reach here
  type Page = { rows: { it: InvoiceItem; no: number }[]; first: boolean }
  const pages: Page[] = [{ rows: [], first: true }]
  let cursor = 0
  {
    let y = 337 + 39                                     // where the first row starts on page 1
    items.forEach((it, i) => {
      const h = rowHeight(it)
      if (y + h > PAGE_LIMIT) {                          // no room → new page
        pages.push({ rows: [], first: false })
        y = 150 + 39
      }
      pages[pages.length - 1].rows.push({ it, no: i + 1 })
      y += h
    })
    cursor = y
  }
  // Does the totals block (and the footer under it) still fit on the last page?
  let totalsOnNewPage = false
  if (cursor + TOTALS_H > FOOTER_TOP) {
    totalsOnNewPage = true
    pages.push({ rows: [], first: false })
  }

  const pageCount = pages.length
  pages.forEach((pg, pi) => {
    if (pi > 0) doc.addPage()
    let y = pg.first ? drawTop() : drawTopSmall()
    y = drawTableHeader(y)
    pg.rows.forEach(r => { y = drawRow(r.it, r.no, y) })
    const isLast = pi === pageCount - 1
    if (isLast) {
      drawTotals(totalsOnNewPage ? 190 : y)
      drawFooter()
    }
    pageNumber(pi + 1, pageCount)
  })

  return doc
}

/**
 * Makes the invoice and saves it as <invoice no>.pdf (no date in the name).
 *   • If a folder was chosen → into  "Digital Invoice Obello System"  inside it (made if missing)
 *   • Otherwise            → a normal browser download
 * Returns a short sentence telling the cashier where it went.
 */
export async function downloadDigitalInvoice(inv: InvoiceData): Promise<string> {
  const doc = await buildInvoicePdf(inv)
  const fileName = `${inv.invoiceNo}.pdf`
  if (await saveInvoiceToFolder(doc.output('blob'), fileName)) {
    return `Invoice ${inv.invoiceNo} saved in the "${INVOICE_FOLDER_NAME}" folder`
  }
  doc.save(fileName)
  return `Invoice ${inv.invoiceNo} downloaded`
}

// ──────────────────────────────────────────────
// 6. FINDING the customer of a saved bill
//    • Later Pay bills keep the customer on the bill itself (customer_id)
//    • Customer Book sales (cash / card / bank) keep it in "loyal_purchases", found by invoice number
// ──────────────────────────────────────────────
export async function findInvoiceCustomer(customerId: string | null | undefined, invoiceNo: string): Promise<InvoiceCustomer | null> {
  let id = customerId ?? null
  if (!id) {
    const { data } = await supabase.from('loyal_purchases').select('customer_id').eq('invoice_no', invoiceNo).limit(1)
    id = data?.[0]?.customer_id ?? null
  }
  if (!id) return null
  const { data } = await supabase.from('pay_later_customers').select('name, phone, address').eq('id', id).maybeSingle()
  return data ? { name: data.name, phone: data.phone, address: data.address } : null
}
