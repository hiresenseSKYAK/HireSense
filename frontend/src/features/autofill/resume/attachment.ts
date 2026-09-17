import type { ApplicantProfile } from '../core/types'
import type { FieldDecision } from '../matcher/types'
import { matchApplicationFields } from '../matcher/semanticMatcher'
import { resumeFile, type SessionResume } from './contract'

export interface AttachmentResult { attached: boolean; message: string }

export function acceptsResume(input: HTMLInputElement, file: SessionResume): boolean {
  const rules = input.accept.toLowerCase().split(',').map((rule) => rule.trim()).filter(Boolean)
  return !rules.length || rules.some((rule) => rule === file.type || rule === '*/*' ||
    (rule.startsWith('.') && file.name.toLowerCase().endsWith(rule)) ||
    (rule.endsWith('/*') && file.type.startsWith(rule.slice(0, -1))))
}

// Called only for the separate, explicitly authorized attachment action.
// A site may upload bytes as soon as its change handler runs.
export async function attachResume(root: ParentNode, profile: ApplicantProfile, approved: FieldDecision, payload: SessionResume): Promise<AttachmentResult> {
  const current = matchApplicationFields(root, profile).find((d) => d.element === approved.element)
  if (!current?.attachment || current.snapshot !== approved.snapshot || !approved.element.isConnected ||
    !(approved.element instanceof HTMLInputElement) || approved.element.files?.length) {
    return { attached: false, message: 'The resume field changed or already has a file. Preview again; existing attachments are preserved.' }
  }
  if (!acceptsResume(approved.element, payload)) return { attached: false, message: 'This page does not accept the active resume type. Use its own Attach button.' }
  try {
    const file = resumeFile(payload)
    const expectedBytes = new Uint8Array(await file.arrayBuffer())
    const fresh = matchApplicationFields(root, profile).find((d) => d.element === approved.element)
    if (fresh?.snapshot !== approved.snapshot || approved.element.files?.length) return { attached: false, message: 'The resume field changed. Preview again.' }
    const transfer = new DataTransfer()
    transfer.items.add(file)
    approved.element.files = transfer.files
    approved.element.dispatchEvent(new Event('input', { bubbles: true }))
    approved.element.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 180))
    const retained = approved.element.files
    const same = approved.element.isConnected && retained?.length === 1 &&
      retained[0].name === file.name && retained[0].size === file.size && retained[0].type === file.type &&
      new Uint8Array(await retained[0].arrayBuffer()).every((byte, i) => byte === expectedBytes[i])
    return same
      ? { attached: true, message: 'Resume attached to the file field. Check the site’s upload status; server acceptance is not verified.' }
      : { attached: false, message: 'Resume handoff could not be verified. Check the site before retrying; it may already have uploaded the file.' }
  } catch {
    return { attached: false, message: 'This page could not accept the resume through the extension. Use its own Attach button and review any upload status.' }
  }
}
