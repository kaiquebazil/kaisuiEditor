import { useEffect, useMemo, useState } from 'react'
import { fetchFile } from '@ffmpeg/util'
import {
  AlertCircle,
  Download,
  ImagePlus,
  LoaderCircle,
  Scissors,
  Trash2,
  Upload,
  Video,
} from 'lucide-react'
import { useFFmpeg } from './hooks/useFFmpeg'
import {
  buildKeepSegments,
  buildOverlayFilterChain,
  formatSeconds,
  parseSilenceRanges,
} from './lib/ffmpegFilters'
import type { OverlayItem, SilenceRange, TimelineSegment } from './types/editor'

const ACCEPTED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
]

const createOverlay = (): OverlayItem => ({
  id: crypto.randomUUID(),
  time: 0,
  duration: 2,
  file: null,
  previewUrl: null,
})

const sanitizeFilename = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '')

function App() {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [sourceVideoUrl, setSourceVideoUrl] = useState<string | null>(null)
  const [processedVideoUrl, setProcessedVideoUrl] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [silenceCuts, setSilenceCuts] = useState<SilenceRange[]>([])
  const [keptSegments, setKeptSegments] = useState<TimelineSegment[]>([])
  const [overlays, setOverlays] = useState<OverlayItem[]>([createOverlay()])
  const [isRunningJumpCut, setIsRunningJumpCut] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)

  const {
    isLoaded,
    isLoading,
    progress,
    error: ffmpegError,
    load,
    clearLogs,
    getLogsSnapshot,
    runCommand,
    writeFile,
    deleteFile,
  } = useFFmpeg()

  useEffect(() => {
    load().catch(() => {
      // Erro já tratado dentro do hook
    })
  }, [load])

  useEffect(() => {
    return () => {
      if (sourceVideoUrl) URL.revokeObjectURL(sourceVideoUrl)
      if (processedVideoUrl) URL.revokeObjectURL(processedVideoUrl)
      overlays.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentPreviewUrl = processedVideoUrl ?? sourceVideoUrl

  const canRun = !!videoFile && isLoaded && !isLoading

  const errorMessage = uiError ?? ffmpegError

  const onSelectVideo = (file: File | null) => {
    setUiError(null)

    if (!file) return

    if (!ACCEPTED_VIDEO_TYPES.includes(file.type)) {
      setUiError('Formato não suportado. Envie MP4, WEBM, MOV ou MKV.')
      return
    }

    if (sourceVideoUrl) URL.revokeObjectURL(sourceVideoUrl)
    if (processedVideoUrl) URL.revokeObjectURL(processedVideoUrl)

    const nextSource = URL.createObjectURL(file)

    setVideoFile(file)
    setSourceVideoUrl(nextSource)
    setProcessedVideoUrl(null)
    setSilenceCuts([])
    setKeptSegments([])
  }

  const onDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    onSelectVideo(file ?? null)
  }

  const setOverlayImage = (overlayId: string, file: File | null) => {
    setOverlays((prev) =>
      prev.map((item) => {
        if (item.id !== overlayId) return item

        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl)
        }

        if (!file) {
          return { ...item, file: null, previewUrl: null }
        }

        return {
          ...item,
          file,
          previewUrl: URL.createObjectURL(file),
        }
      }),
    )
  }

  const updateOverlay = (overlayId: string, partial: Partial<OverlayItem>) => {
    setOverlays((prev) => prev.map((item) => (item.id === overlayId ? { ...item, ...partial } : item)))
  }

  const removeOverlay = (overlayId: string) => {
    setOverlays((prev) => {
      const overlay = prev.find((item) => item.id === overlayId)
      if (overlay?.previewUrl) URL.revokeObjectURL(overlay.previewUrl)
      return prev.filter((item) => item.id !== overlayId)
    })
  }

  const processVideo = async (options: {
    outputName: string
    applyJumpCut: boolean
    applyOverlays: boolean
  }): Promise<Blob> => {
    if (!videoFile) {
      throw new Error('Selecione um vídeo antes de processar.')
    }

    const cleanedName = sanitizeFilename(videoFile.name || 'input.mp4')
    const inputName = `input_${Date.now()}_${cleanedName}`

    await writeFile(inputName, await fetchFile(videoFile))

    const overlayInputs = overlays.filter((item) => item.file && item.duration > 0)
    const overlayNames: string[] = []

    for (const [index, overlay] of overlayInputs.entries()) {
      const file = overlay.file as File
      const fileName = `overlay_${index}_${Date.now()}_${sanitizeFilename(file.name || 'overlay.png')}`
      overlayNames.push(fileName)
      await writeFile(fileName, await fetchFile(file))
    }

    const args: string[] = ['-i', inputName]
    overlayNames.forEach((name) => {
      args.push('-loop', '1', '-i', name)
    })

    const filters: string[] = []
    let mapVideo = '0:v'
    let mapAudio = '0:a?'

    if (options.applyJumpCut && keptSegments.length > 0) {
      const concatInputs: string[] = []

      keptSegments.forEach((segment, index) => {
        const start = Math.max(0, segment.start)
        const end = Math.max(start + 0.01, segment.end)

        filters.push(`[0:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`)
        filters.push(`[0:a]atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`)
        concatInputs.push(`[v${index}][a${index}]`)
      })

      filters.push(`${concatInputs.join('')}concat=n=${keptSegments.length}:v=1:a=1[vBase][aBase]`)
      mapVideo = 'vBase'
      mapAudio = 'aBase'
    }

    if (options.applyOverlays && overlayInputs.length > 0) {
      const startInput = 1
      const { filters: overlayFilters, finalVideoLabel } = buildOverlayFilterChain(mapVideo, overlayInputs, startInput)
      filters.push(...overlayFilters)
      mapVideo = finalVideoLabel
    }

    if (filters.length > 0) {
      args.push('-filter_complex', filters.join(';'))
      args.push('-map', `[${mapVideo}]`)
      args.push('-map', mapAudio.startsWith('a') ? `[${mapAudio}]` : mapAudio)
    } else {
      args.push('-map', '0:v', '-map', '0:a?')
    }

    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '24',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-pix_fmt',
      'yuv420p',
      '-shortest',
      options.outputName,
    )

    const outputBytes = await runCommand(args, { outputFile: options.outputName })
    if (!outputBytes) {
      throw new Error('FFmpeg não retornou o arquivo de saída.')
    }

    await deleteFile(inputName)
    await Promise.all(overlayNames.map((name) => deleteFile(name)))

    const safeBytes = new Uint8Array(outputBytes.byteLength)
    safeBytes.set(outputBytes)

    return new Blob([safeBytes], { type: 'video/mp4' })
  }

  const runAutoJumpCut = async () => {
    if (!videoFile || !videoDuration) {
      setUiError('Carregue um vídeo e aguarde o player ler a duração antes de usar o Jump Cut.')
      return
    }

    setUiError(null)
    setIsRunningJumpCut(true)

    const detectInputName = `detect_${Date.now()}_${sanitizeFilename(videoFile.name || 'input.mp4')}`

    try {
      clearLogs()
      await writeFile(detectInputName, await fetchFile(videoFile))

      await runCommand([
        '-i',
        detectInputName,
        '-af',
        'silencedetect=noise=-30dB:d=0.35',
        '-f',
        'null',
        '-',
      ])

      const detectedRanges = parseSilenceRanges(getLogsSnapshot())
      const keepSegments = buildKeepSegments(videoDuration, detectedRanges)

      if (!keepSegments.length) {
        throw new Error('Não foi possível montar segmentos após detectar silêncios.')
      }

      setSilenceCuts(detectedRanges)
      setKeptSegments(keepSegments)

      const jumpCutBlob = await processVideo({
        outputName: `jumpcut_${Date.now()}.mp4`,
        applyJumpCut: true,
        applyOverlays: false,
      })

      if (processedVideoUrl) URL.revokeObjectURL(processedVideoUrl)
      setProcessedVideoUrl(URL.createObjectURL(jumpCutBlob))
    } catch (processingError) {
      const detail = processingError instanceof Error ? processingError.message : 'Erro desconhecido ao processar.'
      setUiError(
        `Falha no Jump Cut automático. Detalhes: ${detail}. Dica: teste com vídeo em MP4 (H.264 + AAC).`,
      )
    } finally {
      await deleteFile(detectInputName)
      setIsRunningJumpCut(false)
    }
  }

  const exportFinalVideo = async () => {
    if (!videoFile) {
      setUiError('Selecione um vídeo antes de exportar.')
      return
    }

    setUiError(null)
    setIsExporting(true)

    try {
      const finalBlob = await processVideo({
        outputName: `kaisui_final_${Date.now()}.mp4`,
        applyJumpCut: keptSegments.length > 0,
        applyOverlays: true,
      })

      if (processedVideoUrl) URL.revokeObjectURL(processedVideoUrl)
      const finalUrl = URL.createObjectURL(finalBlob)
      setProcessedVideoUrl(finalUrl)

      const anchor = document.createElement('a')
      anchor.href = finalUrl
      anchor.download = `kaisui_editor_${Date.now()}.mp4`
      anchor.click()
    } catch (processingError) {
      const detail = processingError instanceof Error ? processingError.message : 'Erro desconhecido na exportação.'
      setUiError(
        `Não foi possível exportar o vídeo final. Detalhes: ${detail}. Verifique se o vídeo tem áudio e tente novamente.`,
      )
    } finally {
      setIsExporting(false)
    }
  }

  const jumpCutSummary = useMemo(() => {
    if (!silenceCuts.length) return 'Nenhum silêncio detectado ainda.'

    const totalRemoved = silenceCuts.reduce((acc, item) => acc + item.duration, 0)
    return `${silenceCuts.length} cortes detectados • ${formatSeconds(totalRemoved)} removidos`
  }, [silenceCuts])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto grid w-full max-w-7xl gap-6 p-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-xl">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Kaisui Editor</h1>
              <p className="text-sm text-slate-300">MVP de edição automática de vídeo no navegador</p>
            </div>
            <div className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
              FFmpeg: {isLoaded ? 'pronto' : isLoading ? 'carregando...' : 'aguardando'}
            </div>
          </header>

          <label
            className="group block cursor-pointer rounded-xl border-2 border-dashed border-slate-700 p-5 transition hover:border-cyan-400"
            onDrop={onDrop}
            onDragOver={(event) => event.preventDefault()}
          >
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
              className="hidden"
              onChange={(event) => onSelectVideo(event.target.files?.[0] ?? null)}
            />
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <Upload className="size-5 text-cyan-400" />
              Arraste um vídeo aqui ou clique para selecionar.
            </div>
          </label>

          <div className="overflow-hidden rounded-xl border border-slate-800 bg-black">
            {currentPreviewUrl ? (
              <video
                className="h-auto w-full"
                controls
                src={currentPreviewUrl}
                onLoadedMetadata={(event) => setVideoDuration(event.currentTarget.duration || 0)}
              />
            ) : (
              <div className="flex h-72 items-center justify-center text-slate-500">
                <Video className="mr-2 size-5" />
                Preview do vídeo aparecerá aqui.
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={runAutoJumpCut}
              disabled={!canRun || isRunningJumpCut}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 font-medium text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
            >
              {isRunningJumpCut ? <LoaderCircle className="size-4 animate-spin" /> : <Scissors className="size-4" />}
              Jump Cut Automático
            </button>

            <button
              onClick={exportFinalVideo}
              disabled={!canRun || isExporting}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
            >
              {isExporting ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              Exportar MP4
            </button>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
            <div className="mb-1 font-medium">Progresso FFmpeg</div>
            <div className="h-2 overflow-hidden rounded bg-slate-700">
              <div className="h-full bg-cyan-400 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="mt-1">{Math.round(progress * 100)}%</div>
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-rose-600/40 bg-rose-950/40 p-3 text-sm text-rose-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-xl">
            <h2 className="mb-2 text-lg font-semibold">Cortes automáticos</h2>
            <p className="mb-3 text-xs text-slate-400">{jumpCutSummary}</p>
            <div className="max-h-56 space-y-2 overflow-auto pr-1">
              {silenceCuts.length === 0 ? (
                <p className="text-xs text-slate-500">Após rodar o Jump Cut, os silêncios aparecem aqui.</p>
              ) : (
                silenceCuts.map((cut, index) => (
                  <div key={`${cut.start}-${cut.end}-${index}`} className="rounded-lg border border-slate-700 p-2 text-xs">
                    <div className="font-medium">Corte #{index + 1}</div>
                    <div className="text-slate-300">
                      {formatSeconds(cut.start)} → {formatSeconds(cut.end)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Overlays de imagem</h2>
              <button
                onClick={() => setOverlays((prev) => [...prev, createOverlay()])}
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-cyan-400"
              >
                + Adicionar
              </button>
            </div>

            <div className="max-h-[22rem] space-y-3 overflow-auto pr-1">
              {overlays.map((overlay, index) => (
                <div key={overlay.id} className="space-y-2 rounded-lg border border-slate-700 p-3">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>Overlay #{index + 1}</span>
                    <button
                      onClick={() => removeOverlay(overlay.id)}
                      className="inline-flex items-center gap-1 text-rose-300 hover:text-rose-200"
                    >
                      <Trash2 className="size-3" /> Remover
                    </button>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-600 p-2 text-xs hover:border-cyan-400">
                    <ImagePlus className="size-4 text-cyan-400" />
                    {overlay.file ? overlay.file.name : 'Selecionar imagem'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(event) => setOverlayImage(overlay.id, event.target.files?.[0] ?? null)}
                    />
                  </label>

                  {overlay.previewUrl && (
                    <img src={overlay.previewUrl} alt="preview overlay" className="max-h-24 rounded border border-slate-700" />
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs">
                      <span className="mb-1 block text-slate-300">Segundo inicial</span>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={overlay.time}
                        onChange={(event) =>
                          updateOverlay(overlay.id, { time: Number(event.target.value) || 0 })
                        }
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
                      />
                    </label>
                    <label className="text-xs">
                      <span className="mb-1 block text-slate-300">Duração (s)</span>
                      <input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={overlay.duration}
                        onChange={(event) =>
                          updateOverlay(overlay.id, {
                            duration: Math.max(0.1, Number(event.target.value) || 2),
                          })
                        }
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

export default App
