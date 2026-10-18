import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { Bold, Code, Heading2, Italic, Link2, List, ListOrdered, Quote, Strikethrough } from 'lucide-react'
import { cn } from '@/lib/utils'

function ToolbarButton({ editor, label, active, onClick, children }: { editor: Editor; label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClick()
        editor.commands.focus()
      }}
      className={cn('flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg', active && 'bg-hover text-fg')}
    >
      {children}
    </button>
  )
}

/** TipTap editor that saves HTML (debounced while typing, immediately on blur). */
export function RichEditor({ value, onSave, placeholder = 'Add a description…' }: { value: string; onSave: (html: string) => void; placeholder?: string }) {
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const last = useRef(value)
  const save = (html: string) => {
    clearTimeout(timer.current)
    const normalized = html === '<p></p>' ? '' : html
    if (normalized !== last.current) {
      last.current = normalized
      onSave(normalized)
    }
  }
  const editor = useEditor({
    // StarterKit 3 includes Link
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true } }), Placeholder.configure({ placeholder })],
    content: value,
    onUpdate: ({ editor }) => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => save(editor.getHTML()), 800)
    },
    onBlur: ({ editor }) => save(editor.getHTML())
  })

  // load new content when switching tasks / external change, unless the user is typing
  useEffect(() => {
    if (editor && !editor.isFocused && value !== last.current) {
      last.current = value
      editor.commands.setContent(value, { emitUpdate: false })
    }
  }, [editor, value])

  useEffect(() => () => clearTimeout(timer.current), [])

  // Tiptap 3 no longer re-renders on every transaction; subscribe to the toolbar state instead
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: !!e?.isActive('bold'),
      italic: !!e?.isActive('italic'),
      strike: !!e?.isActive('strike'),
      heading: !!e?.isActive('heading', { level: 2 }),
      bulletList: !!e?.isActive('bulletList'),
      orderedList: !!e?.isActive('orderedList'),
      blockquote: !!e?.isActive('blockquote'),
      codeBlock: !!e?.isActive('codeBlock'),
      link: !!e?.isActive('link')
    })
  })

  if (!editor || !active) return null
  const tb = [
    { label: 'Bold', icon: <Bold size={13} />, active: active.bold, run: () => editor.chain().toggleBold().run() },
    { label: 'Italic', icon: <Italic size={13} />, active: active.italic, run: () => editor.chain().toggleItalic().run() },
    { label: 'Strikethrough', icon: <Strikethrough size={13} />, active: active.strike, run: () => editor.chain().toggleStrike().run() },
    { label: 'Heading', icon: <Heading2 size={13} />, active: active.heading, run: () => editor.chain().toggleHeading({ level: 2 }).run() },
    { label: 'Bullet list', icon: <List size={13} />, active: active.bulletList, run: () => editor.chain().toggleBulletList().run() },
    { label: 'Numbered list', icon: <ListOrdered size={13} />, active: active.orderedList, run: () => editor.chain().toggleOrderedList().run() },
    { label: 'Quote', icon: <Quote size={13} />, active: active.blockquote, run: () => editor.chain().toggleBlockquote().run() },
    { label: 'Code', icon: <Code size={13} />, active: active.codeBlock, run: () => editor.chain().toggleCodeBlock().run() },
    {
      label: 'Link',
      icon: <Link2 size={13} />,
      active: active.link,
      run: () => setLinkUrl((editor.getAttributes('link').href as string | undefined) ?? 'https://')
    }
  ]
  const applyLink = () => {
    const url = (linkUrl ?? '').trim()
    if (!url || url === 'https://') editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    setLinkUrl(null)
  }
  return (
    <div className="prose-editor rounded-lg border border-line focus-within:border-accent">
      <div className="flex items-center gap-0.5 border-b border-line px-1.5 py-1">
        {tb.map((b) => (
          <ToolbarButton key={b.label} editor={editor} label={b.label} active={b.active} onClick={b.run}>
            {b.icon}
          </ToolbarButton>
        ))}
        {linkUrl !== null && (
          <input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyLink()
              if (e.key === 'Escape') setLinkUrl(null)
            }}
            onBlur={() => setLinkUrl(null)}
            placeholder="Paste a link, Enter to apply (empty removes)"
            className="ml-1 h-6 flex-1 rounded border border-line bg-panel px-1.5 text-xs outline-none focus:border-accent"
          />
        )}
      </div>
      <EditorContent editor={editor} className="px-3 py-2" />
    </div>
  )
}
