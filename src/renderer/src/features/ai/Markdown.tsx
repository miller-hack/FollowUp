import type { ReactNode } from 'react'

/**
 * Minimal Markdown for AI replies: paragraphs, headings, bullet / numbered lists,
 * fenced code, **bold**, *italic*, `code` and [links](https://…).
 * Builds React elements (never innerHTML), so model output can't inject markup.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="space-y-2 leading-relaxed">{blocks(text)}</div>
}

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      i++
      out.push(
        <pre key={out.length} className="overflow-x-auto rounded-md bg-hover p-2 font-mono text-xs select-text">
          {code.join('\n')}
        </pre>
      )
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      out.push(
        <div key={out.length} className={h[1].length <= 2 ? 'font-semibold text-[15px]' : 'font-semibold'}>
          {inline(h[2])}
        </div>
      )
      i++
      continue
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        const indent = /^\s*/.exec(lines[i])![0].length
        items.push(
          <li key={items.length} style={indent >= 2 ? { marginLeft: 16 } : undefined}>
            {inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}
          </li>
        )
        i++
      }
      out.push(
        ordered ? (
          <ol key={out.length} className="list-decimal space-y-0.5 pl-5">{items}</ol>
        ) : (
          <ul key={out.length} className="list-disc space-y-0.5 pl-5">{items}</ul>
        )
      )
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++])
    out.push(
      <p key={out.length} className="whitespace-pre-wrap">
        {inline(para.join('\n'))}
      </p>
    )
  }
  return out
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*\s][^*]*\*)/g

function inline(s: string): ReactNode[] {
  return s.split(INLINE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i} className="rounded bg-hover px-1 font-mono text-[12px]">{part.slice(1, -1)}</code>
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part)
    if (link)
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-accent underline">
          {link[1]}
        </a>
      )
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>
    return part
  })
}
