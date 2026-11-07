export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '')

type RequestOptions = {
  params?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  cacheTtlMs?: number
}

type InFlightRequest = {
  controller: AbortController
  promise: Promise<unknown>
  consumers: number
}

type CacheEntry = { expiresAt: number; data: unknown }

const DEFAULT_TIMEOUT_MS = 15_000
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const inFlightGets = new Map<string, InFlightRequest>()
const responseCache = new Map<string, CacheEntry>()

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

function buildUrl(path: string, params?: RequestOptions['params']) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${API_BASE_URL}${normalizedPath}`)

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    })
  }

  return url.toString()
}

async function responseError(response: Response) {
  let message = `Request failed with status ${response.status}`
  try {
    const data = await response.json()
    if (typeof data?.detail === 'string') message = data.detail
  } catch {
    // Keep the status-based fallback for non-JSON errors.
  }
  return new ApiError(message, response.status)
}

async function fetchJson<T>(method: 'GET' | 'POST', url: string, body: unknown, options: RequestOptions, signal: AbortSignal): Promise<T> {
  const attempts = method === 'GET' ? 2 : 1
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        signal,
        headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
        body: body === null || body === undefined ? undefined : JSON.stringify(body),
      })
      if (response.ok) return (await response.json()) as T
      const error = await responseError(response)
      if (attempt + 1 >= attempts || !TRANSIENT_STATUSES.has(response.status)) throw error
      lastError = error
    } catch (error) {
      if (signal.aborted || attempt + 1 >= attempts || error instanceof ApiError) throw error
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new ApiError('Request failed')
}

function consumeShared<T>(key: string, entry: InFlightRequest, signal?: AbortSignal): Promise<T> {
  entry.consumers += 1
  let released = false
  const release = () => {
    if (released) return
    released = true
    entry.consumers -= 1
    if (entry.consumers === 0 && inFlightGets.get(key) === entry) {
      inFlightGets.delete(key)
      entry.controller.abort()
    }
  }
  if (!signal) return entry.promise.finally(release) as Promise<T>
  if (signal.aborted) {
    release()
    return Promise.reject(new DOMException('The request was aborted.', 'AbortError'))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      release()
      reject(new DOMException('The request was aborted.', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    entry.promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); release(); resolve(value as T) },
      (error) => { signal.removeEventListener('abort', onAbort); release(); reject(error) },
    )
  })
}

async function get<T>(path: string, options: RequestOptions = {}): Promise<{ data: T }> {
  const url = buildUrl(path, options.params)
  const key = `${url}|${JSON.stringify(options.headers ?? {})}`
  const cached = responseCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return { data: cached.data as T }
  if (cached) responseCache.delete(key)

  let entry = inFlightGets.get(key)
  if (!entry) {
    const controller = new AbortController()
    const timeout = window.setTimeout(
      () => controller.abort(new ApiError('Request timed out. Please try again.')),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    const promise = fetchJson<T>('GET', url, undefined, options, controller.signal)
      .then((data) => {
        if ((options.cacheTtlMs ?? 0) > 0) responseCache.set(key, { data, expiresAt: Date.now() + (options.cacheTtlMs ?? 0) })
        return data
      })
      .finally(() => {
        window.clearTimeout(timeout)
        if (inFlightGets.get(key)?.promise === promise) inFlightGets.delete(key)
      })
    entry = { controller, promise, consumers: 0 }
    inFlightGets.set(key, entry)
  }
  return { data: await consumeShared<T>(key, entry, options.signal) }
}

async function post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<{ data: T }> {
  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(new ApiError('Request timed out. Please try again.')),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return { data: await fetchJson<T>('POST', buildUrl(path, options.params), body, options, controller.signal) }
  } finally {
    window.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

const client = { get, post }

export default client
