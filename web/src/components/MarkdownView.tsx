import React, { useMemo } from 'react'

export const MarkdownView: React.FC<{ content: string }> = ({ content }) => {
  const renderedHtml = useMemo(() => {
    if (!content) return ''
    let html = escapeHtml(content)

    // Code blocks
    html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="bg-slate-50 border border-slate-200 rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono text-slate-800"><code>${code}</code></pre>`
    })

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h4 class="font-bold text-sm text-slate-800 mt-3 mb-1">$1</h4>')
    html = html.replace(/^## (.*$)/gim, '<h3 class="font-bold text-base text-slate-900 mt-4 mb-1.5">$1</h3>')
    html = html.replace(/^# (.*$)/gim, '<h2 class="font-bold text-lg text-slate-900 mt-5 mb-2">$1</h2>')

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-slate-900">$1</strong>')

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">$1</code>')

    // Lists
    html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li class="ml-4 list-disc text-sm text-slate-800 my-0.5">$1</li>')

    // Paragraphs
    html = html.replace(/\n\n+/g, '</p><p class="my-2 leading-relaxed">')
    html = html.replace(/\n/g, '<br/>')

    return `<p class="my-1 leading-relaxed">${html}</p>`
  }, [content])

  return (
    <div
      className="prose-assistant text-slate-900 text-[14px] leading-relaxed select-text"
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  )
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
