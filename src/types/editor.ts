export interface SilenceRange {
  start: number
  end: number
  duration: number
}

export interface TimelineSegment {
  start: number
  end: number
}

export interface OverlayItem {
  id: string
  time: number
  duration: number
  file: File | null
  previewUrl: string | null
}
