import type { CustomerInput } from '../db/queries/customerQueries'

/**
 * Parser for the "Patient list.csv" export format (Kroll/similar pharmacy
 * system exports). Columns seen in the wild:
 * Pharmacy #,PatientName,Address1,Address2,City,Province,Postal,Allergies,
 * Birthday,Age,Sex,Email,Comments,Conditions,FamilyMembers,Groups,
 * NursingHome,FamilyDoctor,PhoneNumbers,Plans,TotalRxs,TotalDollars,
 * RxSync Status,QuickCode,PriceGroup,LastUsed,FirstName,LastName,
 * AR Account,Language,Height,Weight,Deceased Date,Network,Care Giver,
 * Caregiver Relationship,Invitation Generated Date,
 * PharmacyLink Established Date,PharmacyLink Registration Status
 *
 * "Pharmacy #" is ignored on purpose (single-pharmacy imports). FirstName /
 * LastName columns are used directly rather than splitting PatientName.
 */

// Real-world exports of this format have shown up saved as Windows-1252 with
// stray literal NUL bytes in place of blank quoted fields (e.g. `" \x00 "`),
// which breaks strict UTF-8 decoding. Strip NULs and decode permissively.
export function decodePatientListCsv(buffer: Buffer): string {
  const cleaned = Buffer.from(Array.from(buffer).filter((b) => b !== 0))
  let text = cleaned.toString('utf8')
  // If decoding as UTF-8 produced replacement characters, the file is
  // probably Windows-1252 (common for pharmacy system exports) — fall back.
  if (text.includes('�')) {
    text = cleaned.toString('latin1')
  }
  // Strip UTF-8 BOM if present.
  return text.replace(/^﻿/, '')
}

function parseCsvLines(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const pushField = (): void => {
    row.push(field)
    field = ''
  }
  const pushRow = (): void => {
    pushField()
    rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      pushField()
    } else if (c === '\r') {
      // skip, \n handles the row break
    } else if (c === '\n') {
      pushRow()
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) pushRow()
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''))
}

export type PatientListImportResult = {
  customers: CustomerInput[]
  skipped: number
  total: number
}

export function parsePatientListCsv(buffer: Buffer): PatientListImportResult {
  const text = decodePatientListCsv(buffer)
  const rows = parseCsvLines(text)
  if (rows.length === 0) return { customers: [], skipped: 0, total: 0 }

  const header = rows[0].map((h) => h.trim())
  const col = (name: string): number => header.indexOf(name)
  const idx = {
    firstName: col('FirstName'),
    lastName: col('LastName'),
    address1: col('Address1'),
    address2: col('Address2'),
    city: col('City'),
    province: col('Province'),
    postal: col('Postal'),
    email: col('Email'),
    phone: col('PhoneNumbers'),
    allergies: col('Allergies'),
    comments: col('Comments'),
    conditions: col('Conditions')
  }

  const get = (r: string[], i: number): string => (i >= 0 && i < r.length ? r[i].trim() : '')

  const customers: CustomerInput[] = []
  let skipped = 0
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const firstName = get(r, idx.firstName)
    const lastName = get(r, idx.lastName)
    if (!firstName && !lastName) {
      skipped++
      continue
    }

    const addressParts = [get(r, idx.address1), get(r, idx.address2), get(r, idx.city)].filter(
      Boolean
    )
    const provincePostal = [get(r, idx.province), get(r, idx.postal)].filter(Boolean).join(' ')
    if (provincePostal) addressParts.push(provincePostal)
    const address = addressParts.join(', ')

    const notesParts = [
      get(r, idx.allergies) && `Allergies: ${get(r, idx.allergies)}`,
      get(r, idx.conditions) && `Conditions: ${get(r, idx.conditions)}`,
      get(r, idx.comments)
    ].filter(Boolean)

    customers.push({
      firstName: firstName || '(Unknown)',
      lastName: lastName || '(Unknown)',
      phone: get(r, idx.phone),
      address,
      email: get(r, idx.email) || null,
      notes: notesParts.length ? notesParts.join(' | ') : null
    })
  }

  return { customers, skipped, total: rows.length - 1 }
}
