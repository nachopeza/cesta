# Cesta, la compra de casa

Lista de la compra compartida para Mamá, Patri y Nacho.
Lo que apunta uno lo ven todos al momento. Al marcar algo como comprado desaparece de la lista.

- **General**: la lista completa, con lo de todas las tiendas. Debajo de cada cosa pone dónde comprarla.
- Al apuntar eliges **Cualquier sitio** (papel de horno, leche…) o una **tienda concreta** (ñoquis → Lidl).
- Al filtrar por una tienda ves lo de esa tienda y, debajo, lo que vale de cualquier sitio.
- Cada cosa lleva un icono según lo que escribes (🥛 leche, 🥟 ñoquis, 🧻 papel…). Las palabras están en la lista `ICONS` de `app.js`.
- **Varias**: pega o escribe una lista entera, una cosa por línea (`2 leche`, `huevos x12`).
- **Lo de siempre**: al abrir Apuntar salen las cosas que más apuntáis. Las vuelves a apuntar con un toque.
- **Deslizar para borrar**: desliza una cosa hacia la izquierda para borrarla (también con opción de deshacer).
- **Deshacer**: si marcas algo por error, tienes 5 segundos para deshacerlo. Lo comprado en las últimas 24 h se puede volver a apuntar.
- Funciona sin cobertura y se sincroniza al volver. Se instala en el móvil como una app.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La estructura de la página |
| `styles.css` | El diseño (colores de cada tienda, tipografías, iconos…) |
| `app.js` | Toda la lógica, comentada paso a paso |
| `firebase-config.js` | **Aquí pegas los datos de tu proyecto Firebase** |
| `firestore.rules` | Reglas de seguridad de la base de datos |
| `sw.js` + `manifest.webmanifest` + `icons/` | Para instalarla en el móvil y abrirla sin conexión |

---

## 1. Probarla en tu Mac (modo prueba)

Los módulos de JavaScript no funcionan abriendo el archivo con doble clic, hace falta un servidor. En el Terminal:

```bash
cd ~/Documents/GitHub/cesta      # o donde tengas la carpeta
python3 -m http.server 8000
```

Abre http://localhost:8000. Mientras no configures Firebase sale un aviso de **Modo prueba**: funciona todo, pero solo en ese navegador.
Para parar el servidor: `Ctrl + C`.

## 2. Crear la base de datos en Firebase (gratis)

1. Entra en https://console.firebase.google.com con tu cuenta de Google → **Crear proyecto** → nombre `cesta` (puedes desactivar Google Analytics, no hace falta).
2. Menú izquierdo → **Compilación → Firestore Database → Crear base de datos**.
   - Ubicación: `europe-southwest1 (Madrid)`.
   - Empieza en **modo producción**.
3. Dentro de Firestore → pestaña **Reglas** → borra lo que haya, pega el contenido de `firestore.rules` y pulsa **Publicar**.
4. Menú izquierdo → **Compilación → Authentication → Comenzar** → pestaña **Método de inicio de sesión** → **Anónimo** → activar → Guardar.
   (Es un inicio de sesión invisible: nadie tiene que poner usuario ni contraseña.)
5. Rueda dentada ⚙️ → **Configuración del proyecto** → abajo, **Tus apps** → icono web `</>` → nombre `Cesta` → Registrar (no marques Hosting).
6. Te enseña un bloque `const firebaseConfig = { ... }`. Copia esos valores en `firebase-config.js`, sustituyendo cada `PEGAR_AQUI`.

Vuelve a probar en local: el aviso de modo prueba desaparece y la lista ya está en la nube. Ábrela en dos pestañas, apunta algo en una y verás que aparece en la otra.

> Los datos de `firebase-config.js` no son una contraseña: Firebase está pensado para que vayan en una web pública. La lista la protegen las reglas del paso 3 y el inicio anónimo del paso 4.

## 3. Subirla a GitHub y publicarla con GitHub Pages

1. En https://github.com/new crea un repositorio llamado `cesta` (público, sin README).
2. En el Terminal:

```bash
cd ~/Documents/GitHub/cesta
git init
git add .
git commit -m "Primera versión de Cesta"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/cesta.git
git push -u origin main
```

3. En GitHub → repo `cesta` → **Settings → Pages** → *Source*: **Deploy from a branch** → Branch `main`, carpeta `/ (root)` → Save.
4. En un par de minutos la tendréis en: `https://TU_USUARIO.github.io/cesta/`. Ese es el link para la familia.
5. En Firebase → **Authentication → Configuración → Dominios autorizados** → añade `TU_USUARIO.github.io`.

**Opcional (más seguridad):** en https://console.cloud.google.com → tu proyecto → *APIs y servicios → Credenciales* → abre la "Browser key" → *Restricciones de aplicaciones*: **Sitios web** → añade `https://TU_USUARIO.github.io/*`. Así esa clave solo funciona desde vuestra web.

## 4. Instalarla en cada móvil

- **iPhone**: abre el link en **Safari** → botón Compartir → **Añadir a pantalla de inicio**.
- **Android**: abre el link en **Chrome** → menú ⋮ → **Instalar aplicación** (o "Añadir a pantalla de inicio").

La primera vez pregunta **¿Quién eres?** (Mamá, Patri o Nacho) y lo recuerda en ese móvil. Para cambiarlo, toca el círculo con la inicial arriba a la derecha.

## 5. Hacer cambios

Edita los archivos, prueba en local y sube los cambios:

```bash
git add .
git commit -m "Describe el cambio"
git push
```

Los móviles cogen la versión nueva al abrir la app con conexión.

**Añadir o quitar una tienda:** en `app.js`, lista `STORES`, añade una línea `{ id: "eroski", name: "Eroski" }` (con `extra: true` si no es súper) y en `styles.css` su color: `--s-eroski: #1B5E9E;`.

**Cambiar las personas:** lista `PROFILES` en `app.js`.

## Cómo se guardan los datos

Firestore guarda dos colecciones:

- `items`: cada cosa apuntada → `name`, `qty`, `store`, `by` (quién lo apuntó), `createdAt`, `done`, `doneAt`, `doneBy`.
- `frecuentes`: cuántas veces se ha apuntado cada cosa, para "Lo de siempre".

Lo comprado se queda 3 días (para "Volver a apuntar") y después se borra solo.
El plan gratuito de Firebase (Spark) os sobra de largo para el uso de una casa.
