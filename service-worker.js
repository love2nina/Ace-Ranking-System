// service-worker.js — ACE 랭킹 시스템 PWA 캐시 관리
// [v60] Firebase SDK + 정적 파일 캐시로 완전 오프라인/standalone 지원

const CACHE_NAME = 'ace-ranking-v60';
const STATIC_ASSETS = [
    './',
    './index.html',
    './app.js',
    './engine.js',
    './firebase-api.js',
    './ui.js',
    './statsService.js',
    './style.css',
    './manifest.json'
];

const CDN_ASSETS = [
    'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js',
    'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js',
    'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js',
    'https://cdn.jsdelivr.net/npm/chart.js'
];

// 설치: 정적 파일 + CDN SDK 사전 캐시
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker v60...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // 정적 파일 캐시
            const staticPromise = cache.addAll(STATIC_ASSETS).catch(err => {
                console.warn('[SW] Static cache partial fail:', err);
            });
            // CDN 파일 캐시 (개별 처리 — 하나 실패해도 나머지 진행)
            const cdnPromises = CDN_ASSETS.map(url =>
                cache.add(url).catch(err => {
                    console.warn(`[SW] CDN cache fail for ${url}:`, err);
                })
            );
            return Promise.all([staticPromise, ...cdnPromises]);
        }).then(() => self.skipWaiting())
    );
});

// 활성화: 이전 버전 캐시 정리
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker v60...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// 요청 가로채기: Network First 전략 (최신 데이터 우선, 실패 시 캐시)
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Firebase API 요청은 가로채지 않음 (Firestore 자체 캐시 사용)
    if (url.hostname.includes('firestore.googleapis.com') || 
        url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('identitytoolkit.googleapis.com')) {
        return;
    }

    // Vercel Analytics 요청도 무시
    if (url.pathname.includes('/_vercel/')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // 정상 응답이면 캐시 업데이트 후 반환
                if (response.ok) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // 네트워크 실패 시 캐시에서 반환
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) return cachedResponse;
                    // HTML 요청인데 캐시도 없으면 오프라인 폴백
                    if (event.request.headers.get('accept')?.includes('text/html')) {
                        return caches.match('./index.html');
                    }
                });
            })
    );
});
