import { createReadStream, existsSync, statSync } from 'fs';
import { pathToFileURL } from 'url';

import { net } from 'electron';
import mime from 'mime';

import { tryGetNeteaseIdFromPath, type NeteaseQualityTypes } from '../common/netease';
import logger from './logger';
import { getNeteaseStream } from './netease/catalog';

export const handleFileProtocol = async (req: GlobalRequest) => {
  try {
    const url = new URL(req.url);

    // NetEase songs stream through this protocol as a proxy: the CDN sends no CORS headers, and
    // the player element (crossOrigin + MediaElementSource) needs a same-scheme response to get
    // audio data through. URLs expire in ~20 minutes, so each request resolves a fresh stream.
    if (url.hostname === 'netease') return await handleNeteaseStreamRoute(req, url);

    const { pathname } = url;
    const decodedPath = decodeURIComponent(pathname);
    const filePath =
      process.platform === 'darwin' ? decodedPath : decodedPath.replace(/^[/\\]{1,2}/gm, '');

    if (!existsSync(filePath)) {
      logger.warn('File not found via nora:// protocol', { url: req.url, filePath });
      return new Response('File not found', { status: 404 });
    }

    const mimeType = mime.getType(filePath) || 'application/octet-stream';
    const stat = statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.get('range');
    logger.silly('Serving file from nora://', { url: req.url, range, filePath, mimeType });

    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    };

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        return new Response(null, {
          status: 416,
          headers: { ...headers, 'Content-Range': `bytes */${fileSize}` }
        });
      }

      const chunksize = end - start + 1;

      // Create a proper ReadableStream from the file stream
      const fileStream = createReadStream(filePath, { start, end });

      const webStream = new ReadableStream({
        start(controller) {
          fileStream.on('data', (chunk) => {
            try {
              // Ensure chunk is a Buffer before converting to Uint8Array
              const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              controller.enqueue(new Uint8Array(bufferChunk));
            } catch (error) {
              // Stream might be closed, ignore the error
              if (controller.desiredSize !== null) {
                controller.error(error);
              }
            }
          });

          fileStream.on('end', () => {
            try {
              controller.close();
            } catch {
              // Stream might already be closed, ignore the error
            }
          });

          fileStream.on('error', (error) => {
            try {
              controller.error(error);
            } catch {
              // Stream might already be closed, ignore the error
            }
          });
        },

        cancel() {
          fileStream.destroy();
        }
      });

      headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
      headers['Content-Length'] = chunksize.toString();

      return new Response(webStream, {
        status: 206,
        headers
      });
    } else {
      const asFileUrl = pathToFileURL(filePath).toString();
      const response = await net.fetch(asFileUrl);
      return response;
    }
  } catch (error) {
    logger.error('Error handling media protocol:', { error }, error);
    return new Response('Internal Server Error', { status: 500 });
  }
};

/**
 * Streams a NetEase CDN file through `nora://`. Streams are never cached: the resolved URL lives
 * only ~20 minutes, so every fetch re-resolves via `song_url_v1`.
 */
const handleNeteaseStreamRoute = async (req: GlobalRequest, url: URL) => {
  const neteaseId = tryGetNeteaseIdFromPath(`${url.protocol}//${url.host}${url.pathname}`);

  if (!neteaseId) {
    return new Response('NetEase song route malformed', { status: 400 });
  }

  const levelParam = url.searchParams.get('level');
  const quality: NeteaseQualityTypes =
    levelParam === 'exhigh' || levelParam === 'lossless' ? levelParam : 'standard';

  let streamInfo;
  try {
    streamInfo = await getNeteaseStream(neteaseId, quality);
  } catch (error) {
    logger.error('Failed to resolve a NetEase stream URL.', { neteaseId, quality, error });
    return new Response('NetEase stream unavailable', { status: 502 });
  }

  // A song without a URL (restricted by VIP-only access, region or removal) cannot be played at
  // all; the renderer treats 4xx as a skip-worthy playback error.
  if (!streamInfo || !streamInfo.playable) {
    return new Response('NetEase stream unavailable', { status: 404 });
  }

  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    // The URL may redirect to several CDN hosts; keep the player's Range prompt alive instead.
    'Cache-Control': 'no-cache',
    'Content-Type': `audio/${streamInfo.type || 'mp3'}`
  };

  if (streamInfo.size > 0) headers['Content-Length'] = `${streamInfo.size}`;

  const range = req.headers.get('range');
  if (range) headers.Range = range;

  try {
    // Preserving the Range header lets seek requests get 206 bodies; otherwise the CDN answers
    // 200 with the full body. Node fetch (undici) follows the CDN's redirects itself; Electron's
    // net.fetch rejects these URLs with net::ERR_INVALID_ARGUMENT even though they are valid.
    const response = await fetch(streamInfo.url, { headers });

    const responseHeaders = new Headers();
    for (const headerName of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = response.headers.get(headerName);
      if (value) responseHeaders.set(headerName, value);
    }
    // The status (200 / 206) and credited range body come from the CDN reply untouched.
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    let urlHost = '';
    try {
      urlHost = new URL(streamInfo.url).host;
    } catch {
      // The resolved URL itself was malformed; the reason above is the useful part.
    }
    logger.error('Failed to proxy a NetEase stream.', { neteaseId, reason, urlHost });
    return new Response('NetEase stream failed', { status: 502 });
  }
};
