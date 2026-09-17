export const MAX_RESUME_BYTES = 2 * 1024 * 1024
export const RESUME_TTL_MS = 30 * 60 * 1000
export interface SessionResume {
  name: string
  type: string
  size: number
  lastModified: number
  base64: string
}
export function resumeType(name: string): string | null {
  if (/\.pdf$/i.test(name)) return 'application/pdf'
  if (/\.docx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return null
}
export function validResume(value: unknown): value is SessionResume {
  if (!value || typeof value !== 'object') return false
  const file = value as SessionResume
  if (typeof file.name !== 'string' || !file.name || file.name.length > 255 || /[\/\\\x00-\x1f]/.test(file.name) ||
    file.type !== resumeType(file.name) || !Number.isInteger(file.size) || file.size <= 0 ||
    file.size > MAX_RESUME_BYTES || !Number.isFinite(file.lastModified) ||
    typeof file.base64 !== 'string' || file.base64.length !== 4 * Math.ceil(file.size / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)) return false
  try { return atob(file.base64).length === file.size } catch { return false }
}
export async function serializeResume(file: File): Promise<SessionResume> {
  const type = resumeType(file.name)
  if (!type || !file.size || file.size > MAX_RESUME_BYTES) throw new Error('Choose a PDF or DOCX resume up to 2 MB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const payload = { name: file.name, type, size: file.size, lastModified: file.lastModified, base64: btoa(binary) }
  if (!validResume(payload)) throw new Error('This resume could not be read.')
  return payload
}
export function resumeFile(payload: SessionResume): File {
  if (!validResume(payload)) throw new Error('The active resume is invalid. Choose it again.')
  const bytes = Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0))
  return new File([bytes], payload.name, { type: payload.type, lastModified: payload.lastModified })
}
