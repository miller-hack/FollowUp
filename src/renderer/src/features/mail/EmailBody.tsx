import { useEffect, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { useSettings } from '@/lib/hooks'

const REMOTE_IMG = /<img\b[^>]*\bsrc\s*=\s*["']?\s*https?:/i
const REMOTE_CSS = /url\(\s*["']?\s*https?:/i

/** Plain-text email with clickable links. */
function TextBody({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>()]+)/g)
  return (
    <div className="text-[13.5px] leading-relaxed break-words whitespace-pre-wrap select-text">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="text-accent underline">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </div>
  )
}

/**
 * HTML email in a sandboxed iframe: no scripts, no forms, no navigation; links open in
 * the default browser. Remote images (tracking pixels) are blocked by CSP unless allowed.
 */
export function EmailBody({ html, text }: { html: string | null; text: string }) {
  const { data: settings } = useSettings()
  const [allowRemote, setAllowRemote] = useState(false)
  const [height, setHeight] = useState(80)
  const frame = useRef<HTMLIFrameElement>(null)
  const remote = allowRemote || !!settings?.mail.loadRemoteImages
  const hasRemote = !!html && (REMOTE_IMG.test(html) || REMOTE_CSS.test(html))

  useEffect(() => {
    const el = frame.current
    if (!el) return
    let ro: ResizeObserver | null = null
    const measure = () => {
      const doc = el.contentDocument
      if (doc?.body) setHeight(Math.max(40, doc.documentElement.scrollHeight))
    }
    const onLoad = () => {
      measure()
      requestAnimationFrame(measure)
      const doc = el.contentDocument
      if (doc?.body) {
        ro?.disconnect()
        ro = new ResizeObserver(measure)
        ro.observe(doc.body)
        // images arriving later change the height
        doc.querySelectorAll('img').forEach((img) => img.addEventListener('load', measure))
      }
    }
    el.addEventListener('load', onLoad)
    // srcdoc may already have loaded before this effect ran
    if (el.contentDocument?.readyState === 'complete' && el.contentDocument.body?.childElementCount) onLoad()
    return () => {
      el.removeEventListener('load', onLoad)
      ro?.disconnect()
    }
  }, [html, remote])

  if (!html) return <TextBody text={text} />

  const csp = `default-src 'none'; img-src data: ${remote ? 'https: http:' : ''}; style-src 'unsafe-inline'${remote ? ' https: http:' : ''}; font-src data:${remote ? ' https:' : ''}`
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>html,body{margin:0;padding:0;overflow:hidden;background:#fff;color:#1f2329;font:14px/1.5 'Segoe UI',Arial,sans-serif;word-wrap:break-word}
body{padding:14px 16px}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}
blockquote{margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555}</style>
</head><body>${html}</body></html>`

  return (
    <div>
      {hasRemote && !remote && (
        <div className="mb-2 flex items-center gap-2 rounded-md bg-hover px-3 py-1.5 text-xs text-muted">
          <ImageOff size={13} /> Remote images are hidden to protect your privacy.
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => setAllowRemote(true)}>
            Show images
          </button>
        </div>
      )}
      <iframe
        key={remote ? 'remote' : 'local'}
        ref={frame}
        title="Email content"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        style={{ height }}
        className="w-full rounded-md border border-line bg-white"
      />
    </div>
  )
}
