/**
 * ============================================================================
 * YUOP Streetwear — نقطة الدخول الرسمية لـ Cloudflare Workers
 * يوجه طلبات /api/* إلى Hono Backend، والباقي إلى Cloudflare Workers Static Assets
 * مع دعم SPA Fallback لجميع مسارات المتجر (/shop, /product/:id, /track, /lp/:slug, /admin).
 * ============================================================================
 */
import type {
  ExecutionContext,
  ExportedHandler,
  Request as CfRequest,
  Response as CfResponse,
} from '@cloudflare/workers-types';
import { workerApiApp } from './app.ts';
import type { WorkerBindings } from './types.ts';

const worker: ExportedHandler<WorkerBindings> = {
  async fetch(request, env, ctx): Promise<CfResponse> {
    const url = new URL(request.url);

    // 1. جميع طلبات API والـ Webhook والملفات المحمية
    if (url.pathname.startsWith('/api/')) {
      const res = await workerApiApp.fetch(
        request as unknown as globalThis.Request,
        env,
        ctx as unknown as ExecutionContext
      );
      return res as unknown as CfResponse;
    }

    // 2. تقديم الملفات الثابتة وواجهة React SPA من Cloudflare Workers Static Assets
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }

      // SPA Fallback لمسارات الصفحات المستقلة عند تحديث المتصفح
      const acceptsHtml = request.headers.get('accept')?.includes('text/html') ?? true;
      const looksLikeFile = /\.[a-z0-9]{1,8}$/i.test(url.pathname);
      if (request.method === 'GET' && acceptsHtml && !looksLikeFile) {
        const indexUrl = new URL('/index.html', url.origin);
        const indexReq = new Request(indexUrl.toString(), {
          method: 'GET',
          headers: request.headers as unknown as HeadersInit,
        });
        return env.ASSETS.fetch(indexReq as unknown as CfRequest);
      }
      return assetResponse;
    }

    return new Response('Static assets binding (ASSETS) is not configured.', {
      status: 404,
    }) as unknown as CfResponse;
  },
};

export default worker;
export { workerApiApp };
