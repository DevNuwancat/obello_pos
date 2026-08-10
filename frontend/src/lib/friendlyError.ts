// friendlyError.ts
//
// Supabase/Postgres errors come back as technical text like:
//   duplicate key value violates unique constraint "products_barcode_key"
// A shop owner has no way to know that means "you typed a barcode that's
// already used by another product." This file translates those raw errors
// into plain-English sentences that name the exact field that's wrong.

type DbError = { code?: string; message?: string; details?: string | null } | null | undefined

// How each database column name should be shown to a real person.
// Add to this list any time a new "must be unique" column shows this error.
const FIELD_LABELS: Record<string, string> = {
  barcode: 'Barcode',
  sku:     'SKU',
  name:    'Product name',
  code:    'Code',
  email:   'Email',
  phone:   'Phone number',
}

// Falls back to turning "sub_category" into "Sub category" for any column
// we haven't given a custom label to above.
function labelFor(column: string): string {
  return FIELD_LABELS[column] || column.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

// Turns a raw Supabase/Postgres error into a sentence a shop owner can act on.
export function friendlyDbError(error: DbError): string {
  if (!error) return 'Something went wrong. Please try again.'

  // Postgres error code 23505 = "unique_violation": you tried to save a
  // value that has to be one-of-a-kind (like a barcode or SKU), but another
  // row in the table already has that exact value.
  if (error.code === '23505') {
    // Supabase's `details` field spells out exactly which column and value
    // collided, e.g.: Key (barcode)=(000-000-042) already exists.
    const match = error.details?.match(/Key \(([^)]+)\)=\(([^)]+)\)/)
    if (match) {
      const [, column, value] = match
      const label = labelFor(column)
      return `This ${label} ("${value}") is already used by another product. Please change the ${label.toLowerCase()} and try again.`
    }

    // Older/less detailed errors only give the constraint name, e.g.
    // "products_barcode_key" — pull the column name out of that instead.
    const nameMatch = error.message?.match(/constraint "[a-z_]+_([a-z]+)_key"/)
    if (nameMatch) {
      const label = labelFor(nameMatch[1])
      return `This ${label} is already used by another product. Please change it and try again.`
    }

    return 'That value is already used by another product. Please change it and try again.'
  }

  // 23502 = "not_null_violation": a required column was left empty.
  if (error.code === '23502') return 'A required field is missing. Please fill in all required fields.'

  // 23503 = "foreign_key_violation": this row points to a category/supplier/
  // owner that was deleted after the form loaded.
  if (error.code === '23503') return 'This links to something that no longer exists. Please refresh and try again.'

  // Anything else: show Postgres's own message rather than hide it completely.
  return error.message || 'Something went wrong. Please try again.'
}
