# Polla Mundial 2026 - App v1

Primera versión para que cada participante registre sus propios pronósticos.

## Incluye

- Node.js + Express
- SQLite
- Formulario de pronósticos
- Ranking básico desde SQLite
- Control de pronósticos por partido
- Registro de resultados vía API

## Instalación local

1. Descomprimir el ZIP.
2. Entrar a la carpeta:

```bash
cd polla_mundial_app_v1
```

3. Instalar dependencias:

```bash
npm install
```

4. Inicializar PINs:

```bash
npm run init-db
```

5. Levantar servidor:

```bash
npm start
```

6. Abrir:

```text
http://localhost:3000
```

## PINs iniciales

- Mary: 1001
- José: 1002
- Jesús: 1003
- Paolo: 1004
- Juli: 1005
- Uriel: 1006
- Daniela: 1007
- Carlos: 1008

## Flujo

1. Participante entra con nombre y PIN.
2. Ve partidos pendientes.
3. Ingresa marcadores.
4. Revisa resumen.
5. Guarda.
6. El pronóstico se registra en SQLite.

## Importante

Esta versión está pensada para probar localmente. Para que todos participen desde internet, el backend debe desplegarse en Render/Railway/Fly.io.

Netlify seguirá siendo útil para el dashboard público estático, pero el formulario con SQLite necesita backend.


## Novedades App v2

- Página /admin.html.
- Registro de resultados desde web.
- Recalculo automático de puntos al guardar resultado.
- Control por partido y participante.
- Panel "Mis pronósticos registrados".
- Botón fijo para revisar y guardar pronósticos.
- Contador de pronósticos completados.

## URLs

- Pronósticos: http://localhost:3000/
- Ranking: http://localhost:3000/dashboard.html
- Administración: http://localhost:3000/admin.html

## PIN administrador

- admin2026


## Actualización de seguridad - Admin oculto

Cambios aplicados:
- Se quitó el botón Admin de la pantalla principal.
- Los participantes solo verán:
  - Registrar pronósticos
  - Ver ranking
- El administrador se mantiene disponible solo por URL directa:

http://localhost:3000/admin.html

- Se eliminó el texto visible "PIN inicial: admin2026" de la pantalla de administración.

## Configurar PIN administrador

Por defecto, el backend usa:

admin2026

Para usar un PIN personalizado en Windows CMD:

set ADMIN_PIN=Carlos2026
npm start

Ejemplo con otro PIN:

set ADMIN_PIN=MiClaveSegura2026
npm start

Importante:
Si ya tienes el servidor corriendo, primero detenlo con CTRL + C y luego vuelve a iniciarlo con el comando anterior.

## URLs

Participantes:
http://localhost:3000/

Ranking:
http://localhost:3000/dashboard.html

Administrador:
http://localhost:3000/admin.html


## App v3 - Dashboard integrado
- Dashboard lee directo de SQLite/API.
- Ya no usa ranking.json ni partidos.json.
- Endpoints: /api/ranking, /api/dashboard, /api/partidos-dashboard, /api/detalle-participante/:nombre.


## App v3.1 - Dashboard mejorado
- Recupera pronósticos por participante con combo.
- Separa evaluados y pendientes.
- Mantiene lectura desde SQLite/API sin JSON.


## App v3.2 - Administración avanzada

Cambios principales:
- Revertir resultado a pendiente desde /admin.html.
- Guardar o actualizar resultado registrado.
- Recalcular ranking manualmente.
- Ver quién pronosticó y quién falta por partido.
- Editar o crear pronóstico de participante desde el panel administrador.
- Todo protegido por ADMIN_PIN.

Archivos modificados:
- server.js
- public/admin.html
- public/admin.js

Endpoints nuevos:
- POST /api/admin/revertir-resultado
- POST /api/admin/recalcular-ranking
- GET /api/admin/control-partido/:id
- GET /api/admin/pronostico
- POST /api/admin/editar-pronostico


## App v3.2.1 - Corrección administrativa

Cambios:
- Muestra SIN PRONÓSTICO cuando el pronóstico está vacío o nulo.
- Corrige Faltantes por partido considerando registros nulos como pendientes.
- Agrega contador Pronósticos recibidos X/8 y Faltantes X/8.
- Evita asignar puntos a pronósticos nulos al recalcular resultados.
- Mejora mensaje al buscar un pronóstico inexistente.

Archivos modificados:
- server.js
- public/admin.js
- README.txt


## App v3.2.2 - Corrección de horarios Perú

Cambios:
- El bloqueo de pronósticos ahora compara fecha/hora en zona horaria Perú (America/Lima / UTC-5), evitando bloqueos anticipados en Render.
- Se agrega script para corregir partidos cargados con +1 hora:
  npm run corregir-horarios-peru

Archivos modificados:
- server.js
- package.json
- scripts/corregir_horarios_peru.js

Pasos recomendados:
1. Reemplazar server.js, package.json y scripts/corregir_horarios_peru.js.
2. Ejecutar en local:
   npm run corregir-horarios-peru
3. Validar:
   Netherlands vs Sweden debe quedar 12:00.
   Germany vs Ivory Coast debe quedar 15:00.
4. Reiniciar:
   npm start
5. Subir cambios a GitHub/Render.
