// =========================================================
// SERVICE WORKER
// Guarda una copia de los archivos de la app para que se pueda
// abrir sin conexión (en el súper sin cobertura, por ejemplo).
// Los DATOS de la lista los gestiona Firebase, no este archivo.
//
// Estrategia "primero red": si hay internet, siempre se baja la
// versión nueva (así los cambios que subas a GitHub llegan solos);
// si no hay internet, se usa la copia guardada.
// =========================================================

const CACHE = "cesta-v4";
const FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/apple-touch-icon.png",
];

// Al instalar: guardamos los archivos
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

// Al activar: borramos cachés viejas
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cada petición: solo nos ocupamos de los archivos de nuestra propia web
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});
