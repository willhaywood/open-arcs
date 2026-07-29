import { useEffect, useRef } from 'react'

export function LogPanel({ log }: { log: readonly string[] }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [log.length])

  return (
    <div className="log" ref={ref}>
      {log.slice(-200).map((line, i) => (
        <div key={i} className={lineClass(line)}>
          {line}
        </div>
      ))}
    </div>
  )
}

function lineClass(line: string): string {
  if (/won|reached|Game ended|scored/.test(line)) return 'log-score'
  if (/attacks|destroyed|lost|trophy|raided/.test(line)) return 'log-battle'
  if (/declared|Chapter/.test(line)) return 'log-emph'
  return ''
}
