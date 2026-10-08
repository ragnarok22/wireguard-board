# WireGuard Board

Dashboard web para administrar múltiples servidores de WireGuard desde una sola
interfaz. Cada servidor expone su propia instancia de
[wireguard-api](https://github.com/ragnarok22/wireguard-api), que permite gestionar
clientes VPN y consultar el estado del servicio mediante una API REST.

## Estado del proyecto

Frontend estático implementado con interfaz en inglés y diseño responsive.
Conecta directamente desde el navegador a cada instancia de la API, sin un
servicio Node intermedio. Incluye registro de servidores, dashboard y gestión
de peers. La integración se verifica con respuestas simuladas del contrato REST;
para usar servidores reales, configura CORS y una versión compatible del backend.

## Funcionalidades

- **Gestión multiserver:** registrar, editar y quitar servidores del dashboard,
  con un nombre, una URL base de la API y credenciales independientes.
- **Vista general:** consultar la disponibilidad de los servidores y la cantidad
  de peers en cada uno.
- **Gestión de peers:** listar, crear, inspeccionar y eliminar clientes VPN en
  el servidor seleccionado. Un peer representa un dispositivo o cliente de
  WireGuard.
- **Configuración de clientes:** descargar un archivo `.conf` listo para importar
  al crear un peer con claves generadas por la API, copiarlo o escanear su QR.
  El código QR se genera localmente, sin enviar las claves a servicios externos.
- **Monitoreo:** visualizar información de tráfico y del último handshake
  disponible en la API.
- **Actualización:** consultas cada 15 segundos en la vista activa y actualización
  manual. El polling se detiene cuando la pestaña está en segundo plano.
- **Sesiones:** bloquear una conexión para descartar su token y los datos en caché.
- **Búsqueda:** filtrar peers por IP, clave, endpoint o actividad reciente.

Registrar un servidor en el dashboard significa conectar una instancia existente
de `wireguard-api`. Su despliegue y la configuración de red se realizan en el
proyecto del backend.

## Integración con wireguard-api

Repositorio del backend: <https://github.com/ragnarok22/wireguard-api>.

El modelo de integración es que cada servidor de WireGuard tenga su
propia instancia de la API y que el dashboard dirija cada operación a la
instancia seleccionada:

```text
WireGuard Board
  ├── wireguard-api · Servidor A
  ├── wireguard-api · Servidor B
  └── wireguard-api · Servidor C
```

### Conexión a un servidor

Pulsa **Add server**, introduce estos datos y selecciona **Test & save**. Se comprueban
tanto `/health` como el acceso autenticado a `/peers` antes de guardar:

| Dato               | Descripción                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| Nombre             | Identificador legible dentro del dashboard.                                 |
| URL base de la API | Dirección HTTP(S) de la instancia, por ejemplo `https://vpn-a.example.com`. |
| Token de API       | Valor de `API_TOKEN` configurado en esa instancia.                          |

La API escucha por defecto en TCP `8008`. Esta dirección es distinta del endpoint
VPN, que utiliza UDP `51820` por defecto y se configura en el backend mediante
`SERVER_ENDPOINT`.

Las operaciones sobre `/peers` requieren el encabezado `X-API-Token`.
Los endpoints `/health` y `/metrics` son públicos. La documentación interactiva
de cada instancia está disponible en `/docs`.

### Endpoints relevantes

| Método   | Endpoint                     | Uso en el dashboard                                                      |
| -------- | ---------------------------- | ------------------------------------------------------------------------ |
| `GET`    | `/health`                    | Consultar disponibilidad, versión, uptime, interfaz y cantidad de peers. |
| `GET`    | `/peers`                     | Listar clientes y sus estadísticas actuales.                             |
| `POST`   | `/peers`                     | Crear un cliente y recibir sus datos en JSON.                            |
| `GET`    | `/peers/{public_key}`        | Consultar un cliente específico.                                         |
| `GET`    | `/peers/{public_key}/config` | Obtener una configuración parcial en JSON.                               |
| `DELETE` | `/peers/{public_key}`        | Eliminar un cliente del servidor.                                        |

La API devuelve la clave privada generada únicamente al crear el cliente y no
la conserva. La descarga de la configuración completa debe realizarse en ese
momento. El endpoint de configuración de un peer existente devuelve el bloque
`[Peer]` del servidor; no recupera la clave privada ni devuelve por sí solo un
archivo completo listo para importar.

### Persistencia y configuraciones

- `localStorage` guarda únicamente nombre, URL e ID de cada servidor, con un esquema
  versionado. El registro es local a ese navegador y origen, no se comparte entre usuarios.
- Los tokens permanecen en memoria. Tras recargar o abrir otra pestaña, las conexiones
  aparecen bloqueadas y requieren introducir el token nuevamente.
- Las consultas se aíslan por servidor y sesión. Cambiar las credenciales, bloquear o
  quitar una conexión descarta su caché.
- La creación usa `POST /peers` y después `GET /peers/{public_key}/config` para combinar
  la clave privada generada con el bloque `[Peer]` real. Se reproduce la configuración
  por defecto del backend: primera dirección asignada, DNS `1.1.1.1` y rutas del bloque
  devuelto por la API.
- Descarga el archivo antes de cerrar el diálogo. Las claves privadas no se guardan en
  browser storage ni se pueden recuperar más tarde desde la API.
- Si falla el segundo paso, **Retry configuration** repite solo el GET. **Save creation
  response** permite conservar la clave privada y dirección para configurar el cliente.
- Las operaciones de creación y eliminación no tienen reintentos automáticos. Si se
  pierde la respuesta de una creación, actualiza la lista antes de volver a crear.
- Los peers existentes solo ofrecen una configuración parcial, identificada como tal.
  Para claves públicas propias, la clave privada se configura en el dispositivo.

El tráfico se muestra desde la perspectiva del servidor, como valores acumulados del
snapshot de WireGuard, no tasas por segundo. **Recent** significa un handshake en los
últimos tres minutos; no representa una conexión permanente ni confirma accesibilidad.

### CORS y HTTPS

Cada API debe permitir el origen donde se sirve el board. Configura CORS en el backend
o en su reverse proxy. Ejemplo para FastAPI, después de crear `app`:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://board.example.com", "http://localhost:5173"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["X-API-Token", "Content-Type"],
    allow_credentials=False,
)
```

El middleware debe responder también al preflight `OPTIONS`. Aplica las cabeceras
CORS a las respuestas de error si lo configuras en un proxy. Usa el origen exacto de
Vite si su puerto cambia. El board no envía cookies ni sigue redirecciones: introduce
la URL final de la API. URLs con un prefijo, como `https://vpn.example.com/api`, están
soportadas.

Un board servido por HTTPS necesita APIs accesibles por HTTPS para evitar bloqueo de
mixed content. La copia al portapapeles requiere un contexto seguro (HTTPS o localhost).

### Compatibilidad del backend

La integración sigue los endpoints documentados en `wireguard-api`. El `main`
revisado durante la implementación (`b703a9c6`) tenía una incompatibilidad interna:
`api.py` esperaba métodos `restore_peers`, `create_peer` y `delete_peer`, y diccionarios
de peers; `wireguard.py` exponía `add_peer`, `remove_peer` y objetos `PeerStats`.
Utiliza una versión del backend con esas operaciones y serialización coherentes.

Las claves públicas se codifican al incluirlas en una URL. El backend y su proxy
deben aceptar claves con `/`, `+` y `=` en los endpoints de detalle/config/eliminación;
si el router decodifica `%2F` como separador antes de resolver la ruta, debe soportar
ese caso. Los tests verifican la codificación emitida por el frontend.

## Stack

- **React 19** y **TypeScript** para la interfaz.
- **Vite 8** para desarrollo y compilación.
- **Tailwind CSS 4** para estilos.
- **shadcn/ui** y **Radix UI** para componentes.
- **Lucide React** para iconos.
- **TanStack Query** para consultas y mutaciones por servidor.
- **Zod** para validar las respuestas del backend.
- **qrcode.react** para códigos QR locales.
- **Oxlint** para análisis estático.
- **Prettier** para formato de código.
- **Vitest**, **Testing Library** y **happy-dom** para pruebas y coverage.
- **pnpm** para gestión de dependencias.

## Desarrollo local

### Requisitos

- Node.js compatible con Vite 8: `20.19+` o `22.12+`.
- pnpm.
- Una o más instancias de `wireguard-api` para conectar
  servidores reales. Consulta su README para desplegarlas.

### Instalación y ejecución

```bash
pnpm install
pnpm dev
```

Abre la URL que indique Vite en la terminal.

### Comandos disponibles

| Comando             | Descripción                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`          | Inicia el servidor de desarrollo.                                               |
| `pnpm format`       | Aplica el formato de Prettier.                                                  |
| `pnpm format:check` | Verifica el formato sin modificar archivos.                                     |
| `pnpm lint`         | Analiza el código con Oxlint y aplica las correcciones automáticas disponibles. |
| `pnpm lint:check`   | Verifica el código con Oxlint sin modificar archivos.                           |
| `pnpm typecheck`    | Comprueba los tipos de la aplicación y la configuración con TypeScript.         |
| `pnpm build`        | Comprueba los tipos con TypeScript y genera la compilación en `dist/`.          |
| `pnpm preview`      | Sirve la compilación localmente para revisarla.                                 |
| `pnpm test`         | Ejecuta pruebas unitarias y de integración con API simulada.                    |
| `pnpm coverage`     | Ejecuta pruebas y genera informes en `coverage/`.                               |
| `pnpm check`        | Ejecuta lint, formato, tipos y pruebas sin modificar archivos.                  |

Los comandos de lint fallan si encuentran errores o advertencias. Para verificar
el código sin modificar archivos:

```bash
pnpm format:check
pnpm lint:check
pnpm typecheck
pnpm test
pnpm coverage
pnpm build
```

## Estructura del proyecto

```text
src/
  app.tsx          # Componente principal
  app.css          # Estilos del componente principal
  main.tsx         # Punto de entrada
  index.css        # Estilos globales y tokens del tema
  components/ui/   # Componentes de shadcn/ui
  features/
    servers/       # Registro y configuración de conexiones
    dashboard/     # Estado, estadísticas y lista de peers
    peers/         # Creación, configuración, detalle y eliminación
  hooks/           # Registro de servidores y sesión en memoria
  lib/             # Cliente API, validación, storage, configuración y formato
  test/            # Fixtures y pruebas de integración
  assets/          # Recursos del frontend
public/            # Recursos estáticos
```

El alias `@/` apunta a `src/`. Los tokens del tema están definidos en
`src/index.css`. La interfaz utiliza un tema claro. Los archivos y carpetas propios
usan kebab-case; los archivos de configuración conservan las convenciones de sus herramientas.

Para agregar componentes de shadcn/ui:

```bash
pnpm dlx shadcn@latest add card input dialog
```

## Despliegue estático

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm coverage
pnpm build
```

Publica el contenido de `dist/` en cualquier hosting estático. No hay variables de
entorno necesarias ni tokens incluidos en el build; las conexiones se registran desde
la interfaz. Los tests no requieren privilegios de red ni una API real.
