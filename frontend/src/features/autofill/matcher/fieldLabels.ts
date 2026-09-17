import type { ApplicationControl } from './types'

// A wrapping label includes its control's option/textarea text in textContent.
// Remove controls from a detached copy; never alter the application itself.
function questionText(node: Element): string {
  const copy = node.cloneNode(true) as Element
  copy.querySelectorAll('input, select, textarea, button, script, style, [aria-hidden="true"]').forEach((child) => child.remove())
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
}

export function fieldLabels(element: ApplicationControl): string[] {
  return Array.from(element.labels ?? []).map(questionText).filter(Boolean)
}

export function ariaLabels(element: Element): string[] {
  const referenced = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id))
    .filter((node): node is HTMLElement => Boolean(node)).map(questionText)
  return [element.getAttribute('aria-label')?.trim() ?? '', ...referenced].filter(Boolean)
}

export function displayField(element: ApplicationControl): string {
  if (element instanceof HTMLInputElement && element.type === 'hidden') return 'Hidden field'
  return ariaLabels(element).join(' ') || fieldLabels(element).join(' ') ||
    element.name?.replace(/[_-]+/g, ' ') || element.id || 'Unlabelled field'
}
