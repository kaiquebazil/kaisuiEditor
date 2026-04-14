# Kaisui Editor (MVP)

Editor de vídeo automatizado no navegador com React + Vite + TypeScript, usando `ffmpeg.wasm` para processar sem backend.

## Funcionalidades

- Upload por clique ou arrastar/soltar
- Preview de vídeo
- **Jump Cut automático** (detecção de silêncio + concatenação de trechos com fala)
- Sidebar com lista de cortes detectados
- **Overlay de imagens** com timestamp e duração editáveis
- Exportação final em MP4
- Tratamento de erros para formatos inválidos e falhas do FFmpeg

## Stack

- React + Vite + TypeScript
- Tailwind CSS
- ffmpeg.wasm (`@ffmpeg/ffmpeg`)
- Lucide React

## Requisitos

- Node.js 20+
- NPM 10+

## Instalação

```bash
npm install
```

## Rodar em desenvolvimento

```bash
npm run dev
```

Abra o endereço mostrado no terminal (geralmente `http://localhost:5173`).

## Build de produção

```bash
npm run build
npm run preview
```

## Deploy na Vercel (sem dor de cabeça)

Este projeto já inclui `vercel.json` com os headers necessários para `SharedArrayBuffer`:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Passos:

1. Suba este projeto no GitHub
2. Importe o repositório na Vercel
3. Framework Preset: **Vite**
4. Build command: `npm run build`
5. Output directory: `dist`

Pronto ✅

## Observações importantes

- Processamento de vídeo no navegador pode consumir bastante CPU/RAM.
- Vídeos grandes (longos ou 4K) podem demorar.
- Para melhor compatibilidade, use MP4 (H.264 + AAC).
- O Jump Cut depende de faixa de áudio para detectar silêncio.

## Estrutura principal

```txt
src/
  hooks/useFFmpeg.ts
  lib/ffmpegFilters.ts
  types/editor.ts
  App.tsx
```
# kaisuiEditor
# kaisuiEditor
