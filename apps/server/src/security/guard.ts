import crypto from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface SecurityContext {
  csrfToken: string;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    const parsed = new URL(`http://${hostHeader}`);
    const host = parsed.hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
}

function isAllowedOrigin(originHeader: string): boolean {
  try {
    const parsed = new URL(originHeader);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

export function registerSecurityGuards(app: FastifyInstance): SecurityContext {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const expectedTokenBuf = Buffer.from(csrfToken, 'utf8');

  const isValidCsrfToken = (provided: unknown): boolean => {
    if (typeof provided !== 'string') return false;
    const providedBuf = Buffer.from(provided, 'utf8');
    if (providedBuf.length !== expectedTokenBuf.length) return false;
    return crypto.timingSafeEqual(providedBuf, expectedTokenBuf);
  };

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Reject missing or non-loopback Host headers (DNS rebinding defense)
    if (!isLoopbackHostHeader(request.headers.host)) {
      return reply.code(403).send({ error: 'Forbidden host header: loopback only' });
    }

    if (MUTATING_METHODS.has(request.method) && request.url.startsWith('/api/')) {
      const origin = request.headers.origin;
      if (origin && !isAllowedOrigin(origin)) {
        return reply.code(403).send({ error: 'Forbidden origin on mutating request' });
      }
      const referer = request.headers.referer;
      if (!origin && referer && !isAllowedOrigin(referer)) {
        return reply.code(403).send({ error: 'Forbidden referer on mutating request' });
      }

      if (!isValidCsrfToken(request.headers['x-atlas-token'])) {
        return reply.code(403).send({ error: 'Missing or invalid X-Atlas-Token CSRF header' });
      }
    }
  });

  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    if (!request.url.startsWith('/api/')) {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
      );
    }
    return payload;
  });

  app.get('/api/session', async (_req, reply) => {
    reply.setCookie('atlas_session', 'local', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });
    return { csrfToken, mode: 'local-first' };
  });

  return { csrfToken };
}
