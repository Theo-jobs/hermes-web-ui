import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { basename, extname, join, resolve } from 'path'
import { promisify } from 'util'
import { config } from '../../config'

const execFileAsync = promisify(execFile)

const HERMES_HOME = resolve(process.env.HERMES_HOME || join(homedir(), '.hermes'))
const HERMES_AGENT_DIR = join(HERMES_HOME, 'hermes-agent')
const HERMES_AGENT_PYTHON = join(HERMES_AGENT_DIR, 'venv', 'bin', 'python')
const STT_UPLOAD_DIR = join(config.uploadDir, 'stt')
const MAX_AUDIO_SIZE = 25 * 1024 * 1024
const SUPPORTED_EXTENSIONS = new Set(['.webm', '.wav', '.mp3', '.m4a', '.ogg'])

const PYTHON_BRIDGE = String.raw`
import contextlib
import io
import json
import os
import sys

audio_path = sys.argv[1]

try:
    with contextlib.redirect_stdout(io.StringIO()):
        language = (
            os.getenv("HERMES_WEBUI_STT_LANGUAGE")
            or os.getenv("STT_LANGUAGE")
            or os.getenv("WHISPER_LANGUAGE")
            or "zh"
        )
        os.environ.setdefault("STT_LANGUAGE", language)
        os.environ.setdefault("WHISPER_LANGUAGE", language)
        from tools.transcription_tools import transcribe_audio
        result = transcribe_audio(audio_path)
except Exception as exc:
    result = {"success": False, "transcript": "", "error": f"{type(exc).__name__}: {exc}"}

print(json.dumps(result, ensure_ascii=False))
`

export interface SttUpload {
  filename: string
  data: Buffer
}

export interface SttResult {
  success: boolean
  transcript: string
  provider?: string
  error?: string
}

export function isSupportedAudioFilename(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extname(filename).toLowerCase())
}

export function assertValidAudioUpload(upload: SttUpload): void {
  if (!upload.filename || !isSupportedAudioFilename(upload.filename)) {
    throw Object.assign(new Error('Unsupported audio format'), { status: 400 })
  }
  if (upload.data.length === 0) {
    throw Object.assign(new Error('Audio file is empty'), { status: 400 })
  }
  if (upload.data.length > MAX_AUDIO_SIZE) {
    throw Object.assign(new Error('Audio file too large'), { status: 413 })
  }
}

export async function saveSttUpload(upload: SttUpload): Promise<string> {
  assertValidAudioUpload(upload)
  await mkdir(STT_UPLOAD_DIR, { recursive: true })
  const ext = extname(upload.filename).toLowerCase()
  const safeBase = basename(upload.filename, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'audio'
  const savedName = `${Date.now()}-${randomBytes(6).toString('hex')}-${safeBase}${ext}`
  const savedPath = join(STT_UPLOAD_DIR, savedName)
  await writeFile(savedPath, upload.data, { mode: 0o600 })
  return savedPath
}

export async function transcribeWithHermes(audioPath: string): Promise<SttResult> {
  try {
    const language = process.env.HERMES_WEBUI_STT_LANGUAGE || process.env.STT_LANGUAGE || process.env.WHISPER_LANGUAGE || 'zh'
    const { stdout } = await execFileAsync(HERMES_AGENT_PYTHON, ['-c', PYTHON_BRIDGE, audioPath], {
      cwd: HERMES_AGENT_DIR,
      env: {
        ...process.env,
        HERMES_WEBUI_STT_LANGUAGE: language,
        STT_LANGUAGE: language,
        WHISPER_LANGUAGE: language,
        PYTHONPATH: process.env.PYTHONPATH
          ? `${HERMES_AGENT_DIR}:${process.env.PYTHONPATH}`
          : HERMES_AGENT_DIR,
      },
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })

    const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
    if (!line) {
      return { success: false, transcript: '', error: 'No transcription result returned' }
    }

    const parsed = JSON.parse(line) as Partial<SttResult>
    return {
      success: parsed.success === true,
      transcript: typeof parsed.transcript === 'string' ? parsed.transcript : '',
      provider: typeof parsed.provider === 'string' ? parsed.provider : undefined,
      error: typeof parsed.error === 'string' ? sanitizeError(parsed.error) : undefined,
    }
  } catch (err: any) {
    return {
      success: false,
      transcript: '',
      error: sanitizeError(err?.message || 'Transcription failed'),
    }
  }
}

function sanitizeError(message: string): string {
  return message
    .replace(/(api[_-]?key|token|authorization|password|secret)(["'=:\s]+)[^\s"',}]+/gi, '$1$2[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .slice(0, 1000)
}
