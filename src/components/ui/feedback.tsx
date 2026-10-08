import { AlertCircle, Check, Copy, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Button } from './button'

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="notice notice-error" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
    </div>
  )
}

export function Spinner() {
  return <LoaderCircle size={16} className="spin" aria-hidden="true" />
}

export function CopyButton({
  text,
  label = 'Copy',
}: {
  text: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setError(false)
    } catch {
      setError(true)
    }
  }
  return (
    <span className="copy-control">
      <Button variant="outline" onClick={copy}>
        {copied ? <Check /> : <Copy />}
        {copied ? 'Copied' : label}
      </Button>
      {error && (
        <span role="alert" className="field-error">
          Copy unavailable. Select the text below instead.
        </span>
      )}
    </span>
  )
}
