import type { OverlayItem, SilenceRange, TimelineSegment } from '../types/editor'

const MIN_SEGMENT_DURATION = 0.05

export const formatSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const cents = Math.floor((seconds % 1) * 100)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cents).padStart(2, '0')}`
}

export const parseSilenceRanges = (logs: string[]): SilenceRange[] => {
  const result: SilenceRange[] = []
  let currentStart: number | null = null

  for (const line of logs) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/)
    if (startMatch) {
      currentStart = Number(startMatch[1])
      continue
    }

    const endMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/)
    if (endMatch) {
      const end = Number(endMatch[1])
      const duration = Number(endMatch[2])
      const start = currentStart ?? Math.max(0, end - duration)

      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        result.push({ start, end, duration: end - start })
      }

      currentStart = null
    }
  }

  return mergeSilenceRanges(result)
}

export const mergeSilenceRanges = (ranges: SilenceRange[]): SilenceRange[] => {
  if (!ranges.length) return []

  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: SilenceRange[] = [sorted[0]]

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]
    const last = merged[merged.length - 1]

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
      last.duration = last.end - last.start
      continue
    }

    merged.push({ ...current })
  }

  return merged
}

export const buildKeepSegments = (
  totalDuration: number,
  silenceRanges: SilenceRange[],
): TimelineSegment[] => {
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return []
  if (!silenceRanges.length) return [{ start: 0, end: totalDuration }]

  const merged = mergeSilenceRanges(silenceRanges)
  const keepSegments: TimelineSegment[] = []
  let cursor = 0

  for (const silence of merged) {
    const keepStart = cursor
    const keepEnd = Math.max(0, silence.start)

    if (keepEnd - keepStart > MIN_SEGMENT_DURATION) {
      keepSegments.push({ start: keepStart, end: keepEnd })
    }

    cursor = Math.max(cursor, silence.end)
  }

  if (totalDuration - cursor > MIN_SEGMENT_DURATION) {
    keepSegments.push({ start: cursor, end: totalDuration })
  }

  return keepSegments
}

interface OverlayFilterResult {
  filters: string[]
  finalVideoLabel: string
}

export const buildOverlayFilterChain = (
  initialVideoLabel: string,
  overlays: OverlayItem[],
  inputIndexStart = 1,
): OverlayFilterResult => {
  const validOverlays = overlays
    .filter((item) => item.file && item.duration > 0)
    .sort((a, b) => a.time - b.time)

  if (!validOverlays.length) {
    return {
      filters: [],
      finalVideoLabel: initialVideoLabel,
    }
  }

  const filters: string[] = []
  let currentLabel = initialVideoLabel

  validOverlays.forEach((overlay, index) => {
    const inputIndex = inputIndexStart + index
    const scaledLabel = `olScaled${index}`
    const nextLabel = `vOverlay${index}`
    const start = Math.max(0, overlay.time)
    const end = Math.max(start + 0.01, overlay.time + overlay.duration)

    filters.push(`[${inputIndex}:v]scale='min(360,iw)':-1[${scaledLabel}]`)
    filters.push(
      `[${currentLabel}][${scaledLabel}]overlay=x=20:y=20:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})':eof_action=pass[${nextLabel}]`,
    )

    currentLabel = nextLabel
  })

  return {
    filters,
    finalVideoLabel: currentLabel,
  }
}
