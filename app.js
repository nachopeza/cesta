// =========================================================
// CESTA · lógica de la app
// ---------------------------------------------------------
// Estructura del archivo:
//   1. Datos fijos (perfiles y tiendas)
//   2. Utilidades pequeñas
//   3. "Backends": dónde se guardan los datos
//      - Firebase (compartido y sincronizado entre todos)
//      - Local (modo prueba, solo en este navegador)
//   4. Estado de la app
//   5. Pintar la pantalla (render)
//   6. Acciones: apuntar, comprar, deshacer, editar…
//   7. Hoja de apuntar / editar
//   8. Perfiles
//   9. Arranque
// =========================================================

import { firebaseConfig } from "./firebase-config.js";

// ---------- 1. DATOS FIJOS ----------

// Las tres personas de casa. "color" es el del círculo con la inicial.
const PROFILES = [
  { id: "mama",  name: "Mamá",  color: "#9C36B5" },
  { id: "patri", name: "Patri", color: "#C2255C" },
  { id: "nacho", name: "Nacho", color: "#0B7285" },
];

// Las tiendas. El color sale de styles.css (--s-<id>).
// "extra: true" son las que no son súper (salen separadas).
// Para añadir una tienda: añade una línea aquí y su color en styles.css.
const STORES = [
  { id: "general",   name: "Cualquier sitio" }, // lo que vale de cualquier súper
  { id: "mercadona", name: "Mercadona" },
  { id: "lidl",      name: "Lidl" },
  { id: "lupa",      name: "Lupa" },
  { id: "dia",       name: "Dia" },
  { id: "bm",        name: "BM" },
  { id: "carrefour", name: "Carrefour" },
  { id: "action",    name: "Action",    extra: true },
  { id: "tedi",      name: "Tedi",      extra: true },
  { id: "primaprix", name: "Primaprix", extra: true },
];

// Cuánto tiempo se quedan guardadas las cosas compradas antes de borrarse del todo
const KEEP_BOUGHT_MS = 3 * 24 * 60 * 60 * 1000; // 3 días
// Cuánto tiempo salen en "Comprado en las últimas 24 h"
const RECENT_MS = 24 * 60 * 60 * 1000;

// ---------- 2. UTILIDADES ----------

// Atajo para buscar elementos: $("#id")
const $ = (sel, root = document) => root.querySelector(sel);

// Buscar tienda/perfil por id (con valor por defecto si no existe)
const storeById = (id) => STORES.find((s) => s.id === id) || STORES[0];
const profileById = (id) => PROFILES.find((p) => p.id === id);

// Color CSS de una tienda
const storeColor = (id) => `var(--s-${storeById(id).id})`;

// Normalizar texto para comparar: "Ñoquis " → "noquis"
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

// Convertir un nombre en un id seguro: "Papel de horno" → "papel-de-horno"
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";

// Primera letra en mayúscula
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// MUY IMPORTANTE: escapar el texto que escribe la gente antes de meterlo en HTML.
// Así nadie puede "colar" código en la lista escribiendo <script> como producto.
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// "hace 5 min", "hace 2 h", "ayer"…
function ago(ts) {
  const s = (Date.now() - (ts || 0)) / 1000;
  if (s < 60) return "ahora";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

// Mostrar cantidad: "2" → "×2", "1 kg" → "1 kg"
const showQty = (q) => (/^\d+$/.test(String(q).trim()) ? `×${q}` : q);

// Entender una línea escrita a mano:
//   "2 leche"      → { name: "Leche", qty: "2" }
//   "1 kg tomates" → { name: "Tomates", qty: "1 kg" }
//   "huevos x12"   → { name: "Huevos", qty: "12" }
function parseLine(line) {
  let text = String(line || "").trim().replace(/^[-•*·]\s*/, ""); // quita viñetas si pegas una lista
  if (!text) return null;
  let qty = "";
  let m = text.match(/^(\d+(?:[.,]\d+)?)\s*(x|kg|g|gr|l|ml|ud|uds|paq|paquetes?|botes?|latas?)?\s+(.+)$/i);
  if (m) {
    qty = m[2] && m[2].toLowerCase() !== "x" ? `${m[1]} ${m[2]}` : m[1];
    text = m[3];
  } else if ((m = text.match(/^(.+?)\s*[x×]\s*(\d+)$/i))) {
    text = m[1];
    qty = m[2];
  }
  return { name: capitalize(text.trim()), qty };
}

// Guardar/leer en el navegador sin que falle si está bloqueado (modo privado, etc.)
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento: no pasa nada */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

// Id aleatorio (para el modo prueba)
const newId = () =>
  (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ---------- 3. BACKENDS ----------
// Los dos backends tienen los mismos métodos, así el resto
// de la app no necesita saber cuál se está usando:
//   onItems(cb)          → avisa cada vez que cambia la lista
//   onFrequent(cb)       → avisa cuando cambian "lo de siempre"
//   add(data)            → apuntar algo nuevo
//   update(id, cambios)  → modificar (ej. marcar comprado)
//   remove(id)           → borrar
//   restore(id, data)    → volver a poner algo borrado con el mismo id
//   bumpFrequent(k, d)   → sumar 1 a las veces que se ha apuntado algo

const isConfigured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("PEGAR");

async function createFirebaseBackend(config) {
  // Cargamos Firebase directamente desde Google (sin instalar nada)
  const V = "11.0.2";
  const base = `https://www.gstatic.com/firebasejs/${V}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const { getAuth, signInAnonymously, onAuthStateChanged } = await import(`${base}/firebase-auth.js`);
  const fs = await import(`${base}/firebase-firestore.js`);

  const app = initializeApp(config);

  // Inicio de sesión anónimo: cada móvil recibe un "pase" invisible.
  // Las reglas de Firestore solo dejan leer/escribir a quien tenga ese pase.
  const auth = getAuth(app);
  await new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, async (user) => {
      stop();
      if (!user) {
        try { await signInAnonymously(auth); } catch (e) { console.warn("Sin sesión (¿sin conexión?)", e); }
      }
      resolve();
    });
  });

  // Base de datos con caché local: funciona sin cobertura y sincroniza al volver
  let db;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app);
  }

  const itemsCol = fs.collection(db, "items");
  const freqCol = fs.collection(db, "frecuentes");
  const onError = (e) => {
    console.error(e);
    toast("No se puede leer la lista. Revisa las reglas de Firestore y el inicio anónimo (README).");
  };

  return {
    mode: "firebase",
    onItems(cb) {
      return fs.onSnapshot(itemsCol, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
    },
    onFrequent(cb) {
      return fs.onSnapshot(freqCol, (snap) => cb(snap.docs.map((d) => ({ key: d.id, ...d.data() }))), onError);
    },
    // No usamos "await" en las escrituras: Firestore actualiza la pantalla al momento
    // y envía el cambio cuando hay conexión.
    add: (data) => fs.addDoc(itemsCol, data).catch(onWriteError),
    update: (id, patch) => fs.updateDoc(fs.doc(itemsCol, id), patch).catch(onWriteError),
    remove: (id) => fs.deleteDoc(fs.doc(itemsCol, id)).catch(onWriteError),
    restore: (id, data) => fs.setDoc(fs.doc(itemsCol, id), data).catch(onWriteError),
    bumpFrequent: (key, data) =>
      fs.setDoc(fs.doc(freqCol, key), { ...data, count: fs.increment(1), lastAt: Date.now() }, { merge: true })
        .catch(onWriteError),
  };
}

function onWriteError(e) {
  console.error(e);
  toast("No se ha podido guardar el cambio. Revisa la conexión.");
}

// Modo prueba: todo en el navegador (localStorage)
function createLocalBackend() {
  const KI = "cesta-demo-items";
  const KF = "cesta-demo-frecuentes";
  const read = (k) => { try { return JSON.parse(storage.get(k)) || {}; } catch { return {}; } };
  let items = read(KI);
  let freq = read(KF);
  const subs = { items: [], freq: [] };

  const emit = () => {
    const list = Object.entries(items).map(([id, v]) => ({ id, ...v }));
    const flist = Object.entries(freq).map(([key, v]) => ({ key, ...v }));
    subs.items.forEach((cb) => cb(list));
    subs.freq.forEach((cb) => cb(flist));
  };
  const save = () => {
    storage.set(KI, JSON.stringify(items));
    storage.set(KF, JSON.stringify(freq));
    emit();
  };
  // Si tienes la app abierta en dos pestañas, se sincronizan entre ellas
  window.addEventListener("storage", (e) => {
    if (e.key === KI || e.key === KF) { items = read(KI); freq = read(KF); emit(); }
  });

  return {
    mode: "local",
    onItems(cb) { subs.items.push(cb); emit(); },
    onFrequent(cb) { subs.freq.push(cb); emit(); },
    add(data) { items[newId()] = { ...data }; save(); },
    update(id, patch) { if (items[id]) { Object.assign(items[id], patch); save(); } },
    remove(id) { delete items[id]; save(); },
    restore(id, data) { items[id] = { ...data }; save(); },
    bumpFrequent(key, data) {
      const prev = freq[key] || { count: 0 };
      freq[key] = { ...prev, ...data, count: (prev.count || 0) + 1, lastAt: Date.now() };
      save();
    },
  };
}

// ---------- 4. ESTADO ----------
// Todo lo que la app "recuerda" mientras está abierta
const state = {
  me: storage.get("cesta-perfil"),            // quién está usando este móvil
  filter: [null, "general"].includes(storage.get("cesta-filtro")) ? "all" : storage.get("cesta-filtro"), // pestaña seleccionada ("all" = General)
  items: [],      // todo lo apuntado (incluido lo comprado reciente)
  freq: [],       // "lo de siempre"
  backend: null,
  editingId: null, // si la hoja está editando algo, su id
  cleaned: false,  // limpieza de comprados antiguos ya hecha
};

// Cosas que se acaban de marcar y están haciendo la animación de salida
const pending = new Map(); // id → temporizador

// ---------- 5. PINTAR LA PANTALLA ----------

// Lo que está por comprar (no comprado, o en plena animación)
const activeItems = () => state.items.filter((i) => !i.done || pending.has(i.id));

function countByStore(list) {
  const c = {};
  for (const i of list) c[i.store] = (c[i.store] || 0) + 1;
  return c;
}

function render() {
  const active = activeItems();
  const counts = countByStore(active);
  renderTabs(active.length, counts);
  renderHeadline(active.length, counts);
  renderList(active);
  renderRecent();
}

// ---------- Iconos de producto ----------
// Se elige un emoji según las palabras de lo que se apunta.
// Para añadir más, pon aquí la palabra SIN tildes y en singular.
const ICONS = {
  "papel higienico": "🧻", "papel de cocina": "🧻", "papel de horno": "🧻", "papel film": "🧻", "papel aluminio": "🧻",
  "pasta de dientes": "🪥", "bolsas de basura": "🗑️", "bolsa de basura": "🗑️", "comida de perro": "🐶", "comida de gato": "🐱",
  "patatas fritas": "🍟", "tomate frito": "🥫", "frutos secos": "🥜", "pan de molde": "🍞",
  leche: "🥛", pan: "🍞", baguette: "🥖", barra: "🥖", huevo: "🥚", tomate: "🍅", patata: "🥔", cebolla: "🧅", ajo: "🧄",
  zanahoria: "🥕", lechuga: "🥬", ensalada: "🥗", espinaca: "🥬", pepino: "🥒", pimiento: "🫑", calabacin: "🥒",
  brocoli: "🥦", platano: "🍌", manzana: "🍎", pera: "🍐", naranja: "🍊", mandarina: "🍊", limon: "🍋", fresa: "🍓",
  uva: "🍇", melon: "🍈", sandia: "🍉", pina: "🍍", aguacate: "🥑", kiwi: "🥝", cereza: "🍒", melocoton: "🍑",
  champinon: "🍄", seta: "🍄", maiz: "🌽", fruta: "🍎", verdura: "🥦", queso: "🧀", yogur: "🥛", mantequilla: "🧈",
  nata: "🥛", pollo: "🍗", carne: "🥩", ternera: "🥩", cerdo: "🥩", filete: "🥩", lomo: "🥩", hamburguesa: "🍔",
  salchicha: "🌭", jamon: "🍖", chorizo: "🍖", embutido: "🍖", pavo: "🍗", pescado: "🐟", salmon: "🐟", merluza: "🐟",
  atun: "🐟", gamba: "🦐", langostino: "🦐", pulpo: "🐙", calamar: "🦑", arroz: "🍚", pasta: "🍝", espagueti: "🍝",
  macarron: "🍝", noqui: "🥟", gnocchi: "🥟", pizza: "🍕", harina: "🌾", azucar: "🍬", sal: "🧂", aceite: "🫒",
  aceituna: "🫒", vinagre: "🍶", cafe: "☕", te: "🍵", infusion: "🍵", cacao: "🍫", chocolate: "🍫", galleta: "🍪",
  cereal: "🥣", muesli: "🥣", avena: "🥣", miel: "🍯", mermelada: "🍯", agua: "💧", zumo: "🧃", refresco: "🥤",
  coca: "🥤", cerveza: "🍺", vino: "🍷", helado: "🍦", palomita: "🍿", nuez: "🥜", almendra: "🥜", cacahuete: "🥜",
  garbanzo: "🫘", lenteja: "🫘", alubia: "🫘", judia: "🫛", guisante: "🫛", sopa: "🍜", caldo: "🍲", lata: "🥫",
  conserva: "🥫", ketchup: "🥫", mayonesa: "🥫", salsa: "🥫", pimienta: "🌶️", especia: "🌶️", bizcocho: "🍰",
  tarta: "🎂", croissant: "🥐", cruasan: "🥐", magdalena: "🧁", tortilla: "🍳", pizzas: "🍕", hielo: "🧊",
  detergente: "🧴", suavizante: "🧴", lejia: "🧴", fregasuelos: "🧴", limpiador: "🧴", lavavajillas: "🧽",
  jabon: "🧼", gel: "🧴", champu: "🧴", crema: "🧴", desodorante: "🧴", cepillo: "🪥", esponja: "🧽", bayeta: "🧽",
  estropajo: "🧽", servilleta: "🧻", panuelo: "🤧", basura: "🗑️", pila: "🔋", bombilla: "💡", vela: "🕯️",
  panal: "👶", toallita: "👶", perro: "🐶", gato: "🐱", flor: "💐", planta: "🪴", regalo: "🎁", juguete: "🧸",
  cuaderno: "📓", boli: "🖊️", taper: "🥡", vaso: "🥤", plato: "🍽️",
};
// Probamos primero las claves largas ("papel de horno" antes que "pan")
const ICON_KEYS = Object.keys(ICONS).sort((a, b) => b.length - a.length);

function iconFor(name) {
  const n = norm(name);
  const words = n.split(/[^a-z0-9]+/).filter(Boolean);
  for (const k of ICON_KEYS) {
    if (k.includes(" ")) {
      if (n.includes(k)) return ICONS[k];
    } else if (k.length <= 3) {
      // Palabras cortas (sal, te, pan…) tienen que coincidir enteras
      if (words.some((w) => w === k || w === `${k}s` || w === `${k}es`)) return ICONS[k];
    } else if (words.some((w) => w.startsWith(k))) {
      return ICONS[k]; // "tomates" empieza por "tomate"
    }
  }
  return "🛒";
}

// Texto de la tienda debajo de cada cosa
const storeLabel = (id) => (id === "general" ? "Cualquier sitio" : storeById(id).name);

// Orden de las tiendas (para ordenar la lista General)
const storeOrder = (id) => STORES.findIndex((s) => s.id === id);

const ICON_LIST = `<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>`;

function renderTabs(total, counts) {
  // "General" = TODO lo apuntado, de todas las tiendas
  const tabs = [{ id: "all", name: "General", n: total }];
  // Después, solo las tiendas con algo apuntado (y la que tengas seleccionada)
  for (const s of STORES) {
    if (s.id === "general") continue;
    if ((counts[s.id] || 0) > 0 || s.id === state.filter) tabs.push({ id: s.id, name: s.name, n: counts[s.id] || 0 });
  }
  $("#tabs").innerHTML = tabs
    .map((t) => {
      const sel = t.id === state.filter;
      const all = t.id === "all";
      const style = all ? "" : `style="--c:${storeColor(t.id)}"`;
      const lead = all ? ICON_LIST : `<span class="tab-dot" aria-hidden="true"></span>`;
      return `<button type="button" role="tab" class="tab${all ? " tab--all" : ""}" ${style} data-filter="${t.id}"
                aria-selected="${sel}">${lead}${esc(t.name)}<span class="count">${t.n}</span></button>`;
    })
    .join("");
}

function renderHeadline(total, counts) {
  const h = $("#headline");
  const sub = $("#subline");
  const f = state.filter;
  const cosas = (n) => (n === 1 ? "1 cosa" : `${n} cosas`);
  const faltan = (n) => (n === 1 ? "Falta 1 cosa" : `Faltan ${n} cosas`);

  if (f === "all") {
    h.textContent = "La compra";
    h.style.removeProperty("--c");
    sub.textContent = total ? faltan(total) : "No falta nada, despensa llena";
  } else {
    const name = storeById(f).name;
    const n = counts[f] || 0;
    const g = counts.general || 0;
    h.textContent = name;
    h.style.setProperty("--c", storeColor(f));
    if (n && g) sub.textContent = `${cosas(n)} de ${name} y ${g} de cualquier sitio`;
    else if (n) sub.textContent = `${faltan(n)} de ${name}`;
    else if (g) sub.textContent = `Nada solo de ${name}, pero hay ${cosas(g)} de cualquier sitio`;
    else sub.textContent = "Aquí no hace falta nada";
  }
}

function renderList(active) {
  const f = state.filter;
  const byDate = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
  let html = "";

  if (f === "all") {
    // Todo junto, ordenado por tienda (y dentro, lo más nuevo arriba)
    const list = [...active].sort((a, b) => storeOrder(a.store) - storeOrder(b.store) || byDate(a, b));
    if (list.length) html = `<ul class="items">${list.map(itemHTML).join("")}</ul>`;
  } else {
    // Lo de esta tienda y, debajo, lo que vale de cualquier sitio
    const own = active.filter((i) => i.store === f).sort(byDate);
    const gen = active.filter((i) => i.store === "general").sort(byDate);
    if (own.length) html += `<ul class="items">${own.map(itemHTML).join("")}</ul>`;
    if (gen.length) html += `<h2 class="sub-head">También de cualquier sitio</h2><ul class="items">${gen.map(itemHTML).join("")}</ul>`;
  }

  $("#list").innerHTML =
    html ||
    `<div class="empty">
       <span class="empty-emoji" aria-hidden="true">🧺</span>
       <p class="empty-title">${f === "all" ? "Lista vacía" : "Nada por aquí"}</p>
       <p>${f === "all" ? "Cuando falte algo, pulsa Apuntar. Lo verá toda la familia al momento." : "No hace falta comprar nada en esta tienda."}</p>
     </div>`;
}

function itemHTML(i) {
  const who = profileById(i.by);
  const doneCls = pending.has(i.id) ? " is-done" : "";
  const qty = i.qty ? `<span class="qty">${esc(showQty(i.qty))}</span>` : "";
  return `<li class="item${doneCls}" data-id="${esc(i.id)}" style="--c:${storeColor(i.store)}">
    <button type="button" class="item-body" data-action="edit" aria-label="Editar ${esc(i.name)}">
      <span class="emoji" aria-hidden="true">${iconFor(i.name)}</span>
      <span class="item-text">
        <span class="item-line"><span class="item-name">${esc(i.name)}</span>${qty}</span>
        <span class="item-meta">
          <span class="store-tag">${esc(storeLabel(i.store))}</span>
          <span class="who">${esc(who ? who.name : "Alguien")}, ${ago(i.createdAt)}</span>
        </span>
      </span>
    </button>
    <button type="button" class="check" data-action="buy" aria-label="Marcar ${esc(i.name)} como comprado">
      <span class="ring"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    </button>
  </li>`;
}

function renderRecent() {
  const now = Date.now();
  const recent = state.items
    .filter((i) => i.done && !pending.has(i.id) && now - (i.doneAt || 0) < RECENT_MS)
    .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))
    .slice(0, 30);
  const box = $("#recent");
  box.hidden = recent.length === 0;
  if (!recent.length) return;
  $("#recent-summary").textContent = `Comprado en las últimas 24 h (${recent.length})`;
  $("#recent-list").innerHTML = recent
    .map((i) => {
      const who = profileById(i.doneBy);
      return `<li data-id="${esc(i.id)}">
        <span class="r-emoji" aria-hidden="true">${iconFor(i.name)}</span>
        <span><span class="r-name">${esc(i.name)}</span><br>
        <span class="r-meta">${esc(who ? who.name : "Alguien")} lo compró ${ago(i.doneAt)}, ${esc(storeLabel(i.store))}</span></span>
        <button type="button" data-action="readd">Volver a apuntar</button>
      </li>`;
    })
    .join("");
}

// ---------- 6. ACCIONES ----------

// Apuntar una cosa. Devuelve { ok } o { dup: item } si ya estaba apuntada.
function addItem({ name, qty = "", store = "general" }) {
  name = capitalize(String(name).trim());
  if (!name) return { empty: true };
  const dup = activeItems().find((i) => norm(i.name) === norm(name) && i.store === store);
  if (dup) return { dup };
  const data = { name, qty: String(qty).trim(), store, by: state.me, createdAt: Date.now(), done: false };
  state.backend.add(data);
  state.backend.bumpFrequent(slug(name), { name, store });
  return { ok: true };
}

// Marcar como comprado, con animación y opción de deshacer
function markBought(id, li) {
  const item = state.items.find((i) => i.id === id);
  if (!item || pending.has(id)) return;

  li.classList.add("is-done");                       // se rellena el círculo
  setTimeout(() => li.classList.add("is-leaving"), 380); // se desliza y desaparece

  const commit = () => {
    pending.delete(id);
    state.backend.update(id, { done: true, doneAt: Date.now(), doneBy: state.me });
  };
  pending.set(id, { timer: setTimeout(commit, 700), commit });

  toast(`Comprado: ${item.name}`, () => {
    const p = pending.get(id);
    if (p) { clearTimeout(p.timer); pending.delete(id); render(); } // aún no se había guardado
    else state.backend.update(id, { done: false, doneAt: null, doneBy: null });
  });
}

// Si cierras la app justo después de marcar, guardamos lo pendiente ya
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    for (const p of [...pending.values()]) { clearTimeout(p.timer); p.commit(); }
  }
});

// Borrar del todo lo comprado hace más de 3 días (lo hace el primero que abra la app)
function cleanupOld() {
  if (state.cleaned) return;
  state.cleaned = true;
  const limit = Date.now() - KEEP_BOUGHT_MS;
  state.items.filter((i) => i.done && (i.doneAt || 0) < limit).forEach((i) => state.backend.remove(i.id));
}

// Aviso inferior. Si le pasas una función, sale el botón "Deshacer".
let toastTimer;
function toast(text, undo) {
  const t = $("#toast");
  const btn = $("#toast-action");
  $("#toast-text").textContent = text;
  btn.hidden = !undo;
  btn.onclick = undo ? () => { undo(); t.hidden = true; } : null;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), undo ? 5000 : 3500);
}

// ---------- 7. HOJA DE APUNTAR / EDITAR ----------
const sheet = $("#sheet");

function renderStoreChips(selected) {
  const chip = (s) => `<label>
      <input type="radio" name="store" value="${s.id}" ${s.id === selected ? "checked" : ""} />
      <span class="chip" style="--c:${storeColor(s.id)}">${esc(s.name)}</span>
    </label>`;
  const supers = STORES.filter((s) => !s.extra).map(chip).join("");
  const extras = STORES.filter((s) => s.extra).map(chip).join("");
  $("#store-chips").innerHTML = `${supers}<span class="sep" aria-hidden="true"></span>${extras}`;
}

const selectedStore = () => (sheet.querySelector('input[name="store"]:checked') || {}).value || "general";
const sheetMode = () => sheet.querySelector('input[name="mode"]:checked').value;

function openSheet(item) {
  state.editingId = item ? item.id : null;
  const editing = !!item;
  $("#sheet-title").textContent = editing ? "Editar" : "Apuntar";
  $("#mode-switch").hidden = editing;
  $("#delete-btn").hidden = !editing;
  $("#submit-btn").textContent = editing ? "Guardar cambios" : "Apuntar";
  $("#sheet-msg").textContent = "";
  sheet.querySelector('input[name="mode"][value="one"]').checked = true;
  applyMode();

  $("#f-name").value = editing ? item.name : "";
  $("#f-qty").value = editing ? item.qty || "" : "";
  $("#f-many").value = "";
  // Tienda por defecto: la de la pestaña en la que estás (o General)
  const def = editing ? item.store : state.filter !== "all" ? state.filter : "general";
  renderStoreChips(def);
  renderSuggest();

  sheet.showModal();
  $("#f-name").focus(); // en iPhone abre el teclado porque viene de un toque
}

function applyMode() {
  const many = sheetMode() === "many";
  $("#one-fields").hidden = many;
  $("#many-fields").hidden = !many;
  $("#submit-btn").textContent = state.editingId ? "Guardar cambios" : many ? "Apuntar todo" : "Apuntar";
  renderSuggest();
}

// Sugerencias: vacío → "lo de siempre"; escribiendo → coincidencias
function renderSuggest() {
  const box = $("#suggest");
  if (state.editingId || sheetMode() === "many") { box.hidden = true; return; }
  const q = norm($("#f-name").value);
  const onList = new Set(activeItems().map((i) => norm(i.name)));
  let list = state.freq.filter((f) => f.name && !onList.has(norm(f.name)));

  if (q) {
    list = list
      .filter((f) => norm(f.name).includes(q))
      .sort((a, b) => (norm(b.name).startsWith(q) - norm(a.name).startsWith(q)) || (b.count || 0) - (a.count || 0))
      .slice(0, 6);
    $("#suggest-label").textContent = "Toca para apuntar";
  } else {
    list = list.sort((a, b) => (b.count || 0) - (a.count || 0) || (b.lastAt || 0) - (a.lastAt || 0)).slice(0, 8);
    $("#suggest-label").textContent = "Lo de siempre. Toca para apuntar";
  }

  box.hidden = list.length === 0;
  $("#suggest-chips").innerHTML = list
    .map((f) => {
      const where = f.store && f.store !== "general" ? ` <span class="plus">${esc(storeById(f.store).name)}</span>` : "";
      const ico = `<span class="chip-emoji" aria-hidden="true">${iconFor(f.name)}</span>`;
      return `<button type="button" class="chip" style="--c:${storeColor(f.store)}" data-key="${esc(f.key)}">${ico}${esc(f.name)}${where}</button>`;
    })
    .join("");
}

function sheetMessage(text) { $("#sheet-msg").textContent = text; }

function whereText(store) { return storeLabel(store); }

function submitSheet() {
  const store = selectedStore();

  // Editar algo que ya existe
  if (state.editingId) {
    const name = capitalize($("#f-name").value.trim());
    if (!name) { sheetMessage("Escribe qué hay que comprar."); return; }
    state.backend.update(state.editingId, { name, qty: $("#f-qty").value.trim(), store });
    sheet.close();
    toast("Cambios guardados");
    return;
  }

  // Varias cosas de golpe
  if (sheetMode() === "many") {
    const lines = $("#f-many").value.split(/\n|;|,\s+/).map(parseLine).filter(Boolean);
    if (!lines.length) { sheetMessage("Escribe una cosa por línea."); return; }
    let added = 0, dups = 0;
    for (const l of lines) {
      const r = addItem({ ...l, store });
      if (r.ok) added++; else if (r.dup) dups++;
    }
    sheet.close();
    const msg = added === 1 ? "Apuntada 1 cosa" : `Apuntadas ${added} cosas`;
    toast(dups ? `${msg} (${dups} ya estaban)` : msg);
    return;
  }

  // Una sola cosa
  const raw = $("#f-name").value.trim();
  if (!raw) { sheetMessage("Escribe qué hay que comprar."); $("#f-name").focus(); return; }
  let { name, qty } = parseLine(raw);
  if ($("#f-qty").value.trim()) qty = $("#f-qty").value.trim();
  const r = addItem({ name, qty, store });
  if (r.dup) {
    const who = profileById(r.dup.by);
    sheetMessage(`${r.dup.name} ya estaba en la lista${who ? ` (lo apuntó ${who.name})` : ""}.`);
  } else {
    sheetMessage(`Apuntado: ${name} (${whereText(store)})`);
  }
  // La hoja se queda abierta para apuntar otra cosa rápido
  $("#f-name").value = "";
  $("#f-qty").value = "";
  $("#f-name").focus();
  renderSuggest();
}

// ---------- 8. PERFILES ----------
// El perfil se guarda en el navegador (localStorage), así no hay que
// elegirlo cada vez. "Cerrar sesión" lo borra y vuelve a la pantalla de inicio.
const accountDialog = $("#account-dialog");

function renderMe() {
  const me = profileById(state.me);
  const btn = $("#me-btn");
  btn.textContent = me ? me.name.charAt(0) : "?";
  btn.style.setProperty("--c", me ? me.color : "var(--ink-2)");
  btn.setAttribute("aria-label", me ? `Perfil: ${me.name}` : "Elegir perfil");
}

// Pantalla de inicio con los tres perfiles
function showWelcome() {
  $("#profile-list").innerHTML = PROFILES.map(
    (p) => `<button type="button" class="profile" data-profile="${p.id}">
      <span class="avatar" style="--c:${p.color}">${p.name.charAt(0)}</span>${esc(p.name)}
      <svg class="profile-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
    </button>`
  ).join("");
  $("#welcome").hidden = false;
  document.body.classList.add("is-welcome");
}

function hideWelcome() {
  $("#welcome").hidden = true;
  document.body.classList.remove("is-welcome");
}

function chooseProfile(id) {
  state.me = id;
  storage.set("cesta-perfil", id); // queda guardado en este navegador
  renderMe();
  hideWelcome();
  window.scrollTo(0, 0);
}

function openAccount() {
  const me = profileById(state.me);
  if (!me) return showWelcome();
  const av = $("#account-avatar");
  av.textContent = me.name.charAt(0);
  av.style.setProperty("--c", me.color);
  $("#account-title").textContent = `Estás como ${me.name}`;
  accountDialog.showModal();
}

function logout() {
  state.me = null;
  storage.remove("cesta-perfil");
  accountDialog.close();
  renderMe();
  showWelcome();
}

// ---------- 9. ARRANQUE ----------
function bindEvents() {
  // Cambiar de pestaña
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    state.filter = b.dataset.filter;
    storage.set("cesta-filtro", state.filter);
    render();
    $(`#tabs [data-filter="${state.filter}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  });

  // Toques en la lista: comprar o editar
  $("#list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    const li = b.closest(".item");
    const id = li.dataset.id;
    if (b.dataset.action === "buy") markBought(id, li);
    if (b.dataset.action === "edit") {
      const item = state.items.find((i) => i.id === id);
      if (item && !pending.has(id)) openSheet(item);
    }
  });

  // Volver a apuntar algo comprado
  $("#recent-list").addEventListener("click", (e) => {
    const b = e.target.closest('[data-action="readd"]');
    if (!b) return;
    const id = b.closest("li").dataset.id;
    const item = state.items.find((i) => i.id === id);
    state.backend.update(id, { done: false, doneAt: null, doneBy: null, createdAt: Date.now(), by: state.me });
    toast(`Apuntado otra vez: ${item ? item.name : ""}`);
  });

  // Botón Apuntar
  $("#add-btn").addEventListener("click", () => (state.me ? openSheet(null) : showWelcome()));

  // Hoja
  $("#sheet-form").addEventListener("submit", (e) => { e.preventDefault(); submitSheet(); });
  sheet.querySelector("[data-close]").addEventListener("click", () => sheet.close());
  sheet.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", applyMode));
  $("#f-name").addEventListener("input", renderSuggest);
  // Cerrar tocando fuera de la hoja
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });

  $("#suggest-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-key]");
    if (!b) return;
    const f = state.freq.find((x) => x.key === b.dataset.key);
    if (!f) return;
    const r = addItem({ name: f.name, store: f.store || "general" });
    sheetMessage(r.dup ? `${f.name} ya estaba en la lista.` : `Apuntado: ${f.name} (${whereText(f.store || "general")})`);
    $("#f-name").value = "";
    renderSuggest();
    $("#f-name").focus();
  });

  $("#delete-btn").addEventListener("click", () => {
    const item = state.items.find((i) => i.id === state.editingId);
    if (!item) return;
    const { id, ...data } = item;
    state.backend.remove(id);
    sheet.close();
    toast(`Borrado: ${item.name}`, () => state.backend.restore(id, data));
  });

  // Perfiles
  $("#me-btn").addEventListener("click", openAccount);
  $("#profile-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-profile]");
    if (b) chooseProfile(b.dataset.profile);
  });
  $("#logout-btn").addEventListener("click", logout);
  accountDialog.querySelector("[data-close-account]").addEventListener("click", () => accountDialog.close());
  accountDialog.addEventListener("click", (e) => { if (e.target === accountDialog) accountDialog.close(); });

  // Aviso de conexión
  const updateOnline = () => {
    const s = $("#status");
    const offline = !navigator.onLine && state.backend?.mode === "firebase";
    s.hidden = !offline;
    s.textContent = "Sin conexión, se guardará al volver";
  };
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  updateOnline();
}

async function start() {
  bindEvents();
  renderMe();
  render();
  // Sin perfil guardado (o perfil desconocido) → pantalla de inicio
  if (!profileById(state.me)) showWelcome();

  // Elegimos backend
  if (isConfigured) {
    try {
      state.backend = await createFirebaseBackend(firebaseConfig);
    } catch (e) {
      console.error(e);
      toast("No se pudo conectar con Firebase. Funcionando en modo prueba.");
      state.backend = createLocalBackend();
    }
  } else {
    state.backend = createLocalBackend();
  }
  $("#demo-banner").hidden = state.backend.mode !== "local";

  // Escuchamos los cambios: cada vez que alguien apunta o compra algo, se repinta
  state.backend.onItems((items) => {
    state.items = items;
    cleanupOld();
    render();
    if (sheet.open) renderSuggest();
  });
  state.backend.onFrequent((freq) => {
    state.freq = freq;
    if (sheet.open) renderSuggest();
  });

  // Refrescar los "hace X min" cada minuto
  setInterval(() => { if (!pending.size) render(); }, 60 * 1000);

  // Service worker: permite instalar la app y abrirla sin conexión
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW", e));
  }
}

start();
