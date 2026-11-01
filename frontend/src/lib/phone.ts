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
