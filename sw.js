/* NS · XỬ LÝ ẢNH — service worker
   - Tăng CACHE mỗi lần đổi index.html để máy nhận bản mới.
   - Bộ AI (./ort, ./models) để ở cache RIÊNG, giữ qua mọi lần cập nhật app.
   - CHỈ dọn cache của chính app này (tiền tố ns-anh-/ns-lib-) — không đụng cache của app khác
     cùng địa chỉ baohan2909.github.io (PhotoFlow, sanpham…). */
const CACHE = 'ns-anh-v20';
const FONT_CACHE = 'ns-anh-fonts-v1';
const AI_CACHE = 'ns-model-isnet-v1';
const KEEP = [CACHE, FONT_CACHE, AI_CACHE];
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks
        .filter(k => (k.indexOf('ns-anh-') === 0 || k.indexOf('ns-lib-') === 0) && KEEP.indexOf(k) < 0)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Cách ly nguồn (COOP/COEP credentialless) -> Chrome cho AI chạy nhiều luồng CPU */
function isolate(resp) {
  if (!resp || resp.type === 'opaque' || resp.type === 'opaqueredirect' || resp.status === 0) return resp;
  const h = new Headers(resp.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Google Fonts — stale-while-revalidate
  if (url.hostname.indexOf('fonts.googleapis.com') >= 0 || url.hostname.indexOf('fonts.gstatic.com') >= 0) {
    e.respondWith(caches.open(FONT_CACHE).then(async c => {
      const cached = await c.match(req);
      const net = fetch(req).then(r => { if (r && r.status === 200) c.put(req, r.clone()); return r; }).catch(() => cached);
      return cached || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // Bộ AI: mục lục .json ưu tiên mạng (nhận bản mới); các phần model/thư viện lấy cache trước
  if (url.pathname.indexOf('/models/') >= 0 || url.pathname.indexOf('/ort/') >= 0) {
    e.respondWith(caches.open(AI_CACHE).then(async c => {
      if (url.pathname.slice(-5) === '.json') {
        try { const r = await fetch(req); if (r && r.status === 200) c.put(req, r.clone()); return isolate(r); }
        catch (_) { return isolate(await c.match(req)) || Response.error(); }
      }
      const hit = await c.match(req);
      if (hit) return isolate(hit);
      const r = await fetch(req);
      if (r && r.status === 200) c.put(req, r.clone());
      return isolate(r);
    }));
    return;
  }

  // Trang chính — ưu tiên mạng (luôn bản mới khi online), mất mạng thì dùng bản đã lưu
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => {
        if (r && r.status === 200 && r.type === 'basic') { const cp = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', cp)); }
        return isolate(r);
      }).catch(() => caches.match('./index.html').then(isolate))
    );
    return;
  }

  // Tài nguyên cùng nguồn khác — cache trước
  e.respondWith(
    caches.match(req).then(hit => hit ? isolate(hit) : fetch(req).then(r => {
      if (r && r.status === 200 && r.type === 'basic') { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return isolate(r);
    }))
  );
});
