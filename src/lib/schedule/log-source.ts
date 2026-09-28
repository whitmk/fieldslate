// The activity-log source suffix for reschedule saves. The two 2026-07
// incidents (a pending interleague game moved without agreement; an accepted
// one moved without a request) could not be traced to a surface because the
// picker's log message named none. Every render site now passes a `logSource`
// and the message ends "— via {source}". ABSENT MEANS UNKNOWN — the message is
// exactly what it was before, so an old entry and a source-less new one read
// the same, and the harness pins both shapes.
export function withLogSource(message: string, logSource: string | undefined): string {
  const src = logSource?.trim();
  return src ? `${message} — via ${src}` : message;
}
