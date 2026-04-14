import { useCallback, useEffect, useRef, useState } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

interface RunCommandOptions {
  outputFile?: string
}

const MAX_LOG_LINES = 400

export function useFFmpeg() {
  const ffmpegRef = useRef<FFmpeg | null>(null)
  const logsRef = useRef<string[]>([])

  const [isLoaded, setIsLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ffmpeg = new FFmpeg()

    ffmpeg.on('log', ({ message }) => {
      logsRef.current = [...logsRef.current, message].slice(-MAX_LOG_LINES)
      setLogs(logsRef.current)
    })

    ffmpeg.on('progress', ({ progress: value }) => {
      setProgress(value)
    })

    ffmpegRef.current = ffmpeg

    return () => {
      ffmpeg.terminate()
      ffmpegRef.current = null
    }
  }, [])

  const clearLogs = useCallback(() => {
    logsRef.current = []
    setLogs([])
  }, [])

  const load = useCallback(async () => {
    if (isLoaded || isLoading) return

    const ffmpeg = ffmpegRef.current
    if (!ffmpeg) {
      throw new Error('Instância do FFmpeg não inicializada.')
    }

    setIsLoading(true)
    setError(null)

    const multiThreadBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm'
    const singleThreadBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'

    try {
      if (typeof SharedArrayBuffer !== 'undefined') {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${multiThreadBase}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${multiThreadBase}/ffmpeg-core.wasm`, 'application/wasm'),
          workerURL: await toBlobURL(`${multiThreadBase}/ffmpeg-core.worker.js`, 'text/javascript'),
        })
      } else {
        await ffmpeg.load({
          coreURL: await toBlobURL(`${singleThreadBase}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${singleThreadBase}/ffmpeg-core.wasm`, 'application/wasm'),
        })
      }

      setIsLoaded(true)
    } catch (loadError) {
      setError(
        'Não foi possível carregar o FFmpeg no navegador. Verifique os headers COOP/COEP (Cross-Origin) e tente novamente.',
      )
      throw loadError
    } finally {
      setIsLoading(false)
    }
  }, [isLoaded, isLoading])

  const runCommand = useCallback(
    async (args: string[], options: RunCommandOptions = {}) => {
      const ffmpeg = ffmpegRef.current
      if (!ffmpeg || !isLoaded) {
        throw new Error('FFmpeg ainda não está carregado.')
      }

      setError(null)
      setProgress(0)

      try {
        await ffmpeg.exec(args)

        if (!options.outputFile) {
          return null
        }

        const data = await ffmpeg.readFile(options.outputFile)
        return data as Uint8Array
      } catch (runError) {
        const baseMessage = runError instanceof Error ? runError.message : 'Erro desconhecido no FFmpeg.'
        setError(baseMessage)
        throw runError
      }
    },
    [isLoaded],
  )

  const writeFile = useCallback(async (filename: string, data: Uint8Array) => {
    const ffmpeg = ffmpegRef.current
    if (!ffmpeg || !isLoaded) {
      throw new Error('FFmpeg ainda não está carregado para escrita de arquivo.')
    }

    await ffmpeg.writeFile(filename, data)
  }, [isLoaded])

  const deleteFile = useCallback(async (filename: string) => {
    const ffmpeg = ffmpegRef.current
    if (!ffmpeg || !isLoaded) return

    try {
      await ffmpeg.deleteFile(filename)
    } catch {
      // arquivo pode não existir; sem problema
    }
  }, [isLoaded])

  const getLogsSnapshot = useCallback(() => [...logsRef.current], [])

  return {
    isLoaded,
    isLoading,
    progress,
    logs,
    error,
    load,
    clearLogs,
    getLogsSnapshot,
    runCommand,
    writeFile,
    deleteFile,
  }
}
