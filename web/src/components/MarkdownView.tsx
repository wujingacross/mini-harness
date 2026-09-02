import React, { useMemo } from 'react'

export const MarkdownView: React.FC<{ content: string }> = ({ content }) => {
  const renderedHtml = useMemo(() => {
    if (!content) return ''
    let html = escapeHtml(content)

    // Code blocks
    html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="bg-[#f8f9fa] border border-slate-200/80 rounded-md px-3.5 py-2.5 my-2.5 overflow-x-auto text-xs font-mono text-slate-800 leading-normal"><code>${code.trim()}</code></pre>`
    })

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h4 class="font-bold text-sm text-slate-800 mt-3 mb-1.5">$1</h4>')
    html = html.replace(/^## (.*$)/gim, '<h3 class="font-bold text-base text-slate-900 mt-4 mb-2">$1</h3>')
    html = html.replace(/^# (.*$)/gim, '<h2 class="font-bold text-lg text-slate-900 mt-5 mb-2.5">$1</h2>')

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-slate-900">$1</strong>')

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono">$1</code>')

    // Lists
    html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li class="ml-4 list-disc text-[14px] text-slate-800 my-1 leading-relaxed">$1</li>')

    // Paragraphs
    html = html.replace(/\n\n+/g, '</p><p class="my-2 leading-relaxed text-[14px]">')
    html = html.replace(/\n/g, '<br/>')

    return `<p class="my-1.5 leading-relaxed text-[14px] text-slate-900">${html}</p>`
  }, [content])

  return (
    <div
      className="prose-assistant text-slate-900 text-[14px] leading-relaxed select-text font-normal"
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  )
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
