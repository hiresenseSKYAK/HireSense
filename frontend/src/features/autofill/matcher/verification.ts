import type { FieldDecision } from './types'

export function equivalentPhone(expected: string, actual: string): boolean {
  // Only presentation characters may differ. Never drop a country code, extension,
  // or leading zero, and never accept a matching suffix of a different number.
  const digits = (value: string) => /^\+?[\d\s().-]+$/.test(value.trim())
    ? value.replace(/\D/g, '') : null
  const left = digits(expected)
  const right = digits(actual)
  return Boolean(left && left.length >= 7 && left.length <= 15 && left === right)
}

export function verifiedValue(decision: FieldDecision): boolean {
  if (!decision.element.isConnected || decision.value === undefined) return false
  return decision.profileKey === 'phone'
    ? equivalentPhone(decision.value, decision.element.value)
    : decision.element.value === decision.value
}
