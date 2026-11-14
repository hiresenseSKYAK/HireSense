import { useMemo } from 'react'
import styles from './JobDescription.module.css'

export type DescriptionBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }

const HEADING_LABELS = [
  'Responsibilities',
  "What You'll Do",
  'What You’ll Do',
  'Requirements',
  'Qualifications',
  'Preferred Qualifications',
  'Minimum Qualifications',
  'About the Role',
  'About Us',
  'Benefits',
  'Compensation',
  'Equal Opportunity',
  'Accommodations',
]

const headingLookup = new Set(HEADING_LABELS.map((heading) => heading.toLocaleLowerCase()))
const headingAlternation = [...HEADING_LABELS]
  .sort((left, right) => right.length - left.length)
  .map((heading) => heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[\t\f\v ]+/g, ' ').trim()
}

function htmlToStructuredText(value: string): string {
  const documentNode = new DOMParser().parseFromString(value, 'text/html')
  documentNode.querySelectorAll('script, style, noscript, template, iframe, object, embed, svg, math')
    .forEach((element) => element.remove())
  documentNode.querySelectorAll('br').forEach((element) => element.replaceWith('\n'))
  documentNode.querySelectorAll('li').forEach((element) => {
    const parent = element.parentElement
    const siblings = parent
      ? [...parent.children].filter((child) => child.tagName.toLowerCase() === 'li')
      : []
    const marker = parent?.tagName.toLowerCase() === 'ol'
      ? `${Math.max(1, siblings.indexOf(element) + 1)}. `
      : '- '
    element.prepend(marker)
    element.before('\n')
    element.after('\n')
  })
  documentNode.querySelectorAll(
    'address, article, aside, blockquote, div, dl, dt, dd, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, main, nav, p, pre, section, table, tbody, td, tfoot, th, thead, tr',
  ).forEach((element) => {
    element.before('\n')
    element.after('\n')
  })
  return documentNode.body.textContent ?? ''
}

function addSemanticBreaks(value: string): string {
  let text = value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
  text = text.replace(/\s*[•●▪◦]\s*/g, '\n- ')
  const numberedItems = text.match(/(?:^|\s)\d+[.)]\s+/g) ?? []
  if (numberedItems.length > 1) text = text.replace(/\s+(?=\d+[.)]\s+)/g, '\n')

  const headingPattern = new RegExp(
    `(^|\\n+|[.!?]\\s+)(${headingAlternation})(?:\\s*:)?(?=\\s|$)`,
    'gim',
  )
  return text.replace(headingPattern, (_match, prefix: string, heading: string) =>
    `${prefix}\n${heading}\n`)
}

function sentenceParagraphs(text: string): string[] {
  if (text.length < 600) return [text]
  const sentences = text.match(/[^.!?]+(?:[.!?]+["')\]]*(?=\s|$)|$)/g)
    ?.map(cleanText)
    .filter(Boolean) ?? []
  if (sentences.length < 4) return [text]
  const paragraphs: string[] = []
  for (let index = 0; index < sentences.length; index += 3) {
    paragraphs.push(sentences.slice(index, index + 3).join(' '))
  }
  return paragraphs
}

export function formatJobDescription(value: string | null | undefined): DescriptionBlock[] {
  if (!value?.trim()) return []
  const containsMarkup = /<\/?[a-z][\s\S]*>/i.test(value)
  const source = containsMarkup ? htmlToStructuredText(value) : value
  const lines = addSemanticBreaks(source).split('\n')
  const blocks: DescriptionBlock[] = []

  for (const rawLine of lines) {
    const line = cleanText(rawLine)
    if (!line) continue

    const headingCandidate = line.replace(/:$/, '').trim()
    if (headingLookup.has(headingCandidate.toLocaleLowerCase()) ||
        (line.endsWith(':') && line.length <= 80 && !/[.!?]/.test(headingCandidate))) {
      blocks.push({ type: 'heading', text: headingCandidate })
      continue
    }

    const unordered = /^[-*]\s+(.+)$/.exec(line)
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (unordered || ordered) {
      const type = unordered ? 'unordered-list' : 'ordered-list'
      const item = cleanText((unordered ?? ordered)![1])
      const previous = blocks[blocks.length - 1]
      if (previous?.type === type) previous.items.push(item)
      else blocks.push({ type, items: [item] })
      continue
    }

    for (const paragraph of sentenceParagraphs(line)) {
      blocks.push({ type: 'paragraph', text: paragraph })
    }
  }

  return blocks
}

export default function JobDescription({ content }: { content: string }) {
  const blocks = useMemo(() => formatJobDescription(content), [content])
  if (!blocks.length) return <p className={styles.empty}>No description available.</p>

  return <div className={styles.description}>
    {blocks.map((block, index) => {
      const key = `${block.type}-${index}`
      if (block.type === 'heading') return <h3 key={key}>{block.text}</h3>
      if (block.type === 'paragraph') return <p key={key}>{block.text}</p>
      if (block.type === 'ordered-list') {
        return <ol key={key}>{block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</ol>
      }
      return <ul key={key}>{block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</ul>
    })}
  </div>
}
