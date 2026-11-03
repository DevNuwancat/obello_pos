// phone.ts
//
// One shared rule for "is this a usable mobile number?", so every form that
// asks for a phone number checks it the same way.
//
// Spaces, dashes, brackets and a leading + are allowed (people type
// "077 123 4567" or "+94 77 123 4567"). What counts is the digits:
// there must be between 9 and 15 of them.

// Returns an error message to show the user, or '' when the number is fine.
export function phoneError(value: string): string {
  const text = value.trim()
  if (!text) return 'Mobile number is required'

  // Only digits and the usual separators — no letters
  if (!/^\+?[0-9\s\-()]+$/.test(text)) return 'Use digits only, e.g. 077 123 4567'

  const digitCount = text.replace(/\D/g, '').length
  if (digitCount < 9 || digitCount > 15) return 'Enter a valid mobile number (9–15 digits)'

  return ''
}

// WhatsApp number is OPTIONAL: empty is fine, but if something is typed it must look like a number.
export function whatsappError(value: string): string {
  const text = value.trim()
  if (!text) return ''
  if (!/^\+?[0-9\s\-()]+$/.test(text)) return 'Use digits only, e.g. 077 123 4567'
  const digitCount = text.replace(/\D/g, '').length
  if (digitCount < 9 || digitCount > 15) return 'Enter a valid WhatsApp number (9–15 digits)'
  return ''
}

// Link that opens a WhatsApp chat with this number. Sri Lankan numbers typed
// as 077… are turned into 9477… (WhatsApp wants the country code, digits only).
export function whatsappLink(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  if (!digits) return ''
  const full = digits.startsWith('0') ? '94' + digits.slice(1) : digits
  return `https://wa.me/${full}`
}

// Two numbers are "the same" when their LAST 9 DIGITS match, so
// 077 123 4567 = 0771234567 = +94 77 123 4567. Returns '' for numbers too short to compare.
export function normalizePhone(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  return digits.length < 9 ? '' : digits.slice(-9)
}
