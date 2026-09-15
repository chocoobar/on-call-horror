import ReactMarkdown from "react-markdown";

export function Prose({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`prose-invert text-sm leading-relaxed text-neutral-200 ${className}`}>
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          code: ({ children }) => (
            <code className="rounded bg-black/40 border border-border px-1 py-0.5 text-accent text-[0.85em]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="rounded-md bg-black/50 border border-border px-3 py-2 my-2 overflow-x-auto text-xs [&_code]:bg-transparent [&_code]:border-0 [&_code]:p-0 [&_code]:text-neutral-200">
              {children}
            </pre>
          ),
          strong: ({ children }) => <strong className="text-neutral-100 font-semibold">{children}</strong>,
          ul: ({ children }) => <ul className="list-disc list-inside space-y-1 mb-2">{children}</ul>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
