# WireGuard Board

Dashboard web para administrar múltiples servidores de WireGuard desde una sola
interfaz. Cada servidor expone su propia instancia de
[wireguard-api](https://github.com/ragnarok22/wireguard-api), que permite gestionar
clientes VPN y consultar el estado del servicio mediante una API REST.

## Estado del proyecto

El proyecto está en su etapa inicial. Actualmente incluye la base del frontend
con React, TypeScript, Vite, Tailwind CSS y shadcn/ui; la pantalla todavía es la
del starter. La gestión de servidores y la integración con la API están
pendientes de implementación.

## Alcance previsto

- **Gestión multiserver:** registrar, editar y quitar servidores del dashboard,
  con un nombre, una URL base de la API y credenciales independientes.
- **Vista general:** consultar la disponibilidad de los servidores y la cantidad
  de peers en cada uno.
- **Gestión de peers:** listar, crear, inspeccionar y eliminar clientes VPN en
  el servidor seleccionado. Un peer representa un dispositivo o cliente de
  WireGuard.
- **Configuración de clientes:** descargar un archivo `.conf` listo para importar
  al crear un peer con claves generadas por la API.
- **Monitoreo:** visualizar información de tráfico y del último handshake
  disponible en la API.

Registrar un servidor en el dashboard significa conectar una instancia existente
de `wireguard-api`. Su despliegue y la configuración de red se realizan en el
proyecto del backend.

## Integración con wireguard-api

Repositorio del backend: <https://github.com/ragnarok22/wireguard-api>.

El modelo de integración previsto es que cada servidor de WireGuard tenga su
propia instancia de la API y que el dashboard dirija cada operación a la
instancia seleccionada:

```text
WireGuard Board
  ├── wireguard-api · Servidor A
  ├── wireguard-api · Servidor B
  └── wireguard-api · Servidor C
```

### Conexión a un servidor

Para cada servidor se necesitará:

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
| `POST`   | `/peers?format=config`       | Crear un cliente y recibir su configuración completa como texto.         |
| `GET`    | `/peers/{public_key}`        | Consultar un cliente específico.                                         |
| `GET`    | `/peers/{public_key}/config` | Obtener una configuración parcial en JSON.                               |
| `DELETE` | `/peers/{public_key}`        | Eliminar un cliente del servidor.                                        |
| `GET`    | `/metrics`                   | Consultar métricas en formato Prometheus.                                |

La API devuelve la clave privada generada únicamente al crear el cliente y no
la conserva. La descarga de la configuración completa debe realizarse en ese
momento. El endpoint de configuración de un peer existente devuelve el bloque
`[Peer]` del servidor; no recupera la clave privada ni devuelve por sí solo un
archivo completo listo para importar.

La persistencia del registro de servidores y sus credenciales, y el mecanismo de
conexión desde el navegador, están por definir. Si se conecta directamente a
APIs de otro origen, la integración deberá resolver CORS; también puede usarse
un proxy de mismo origen. Los tokens de los servidores no deben incorporarse
al bundle del frontend ni almacenarse en el repositorio.

## Stack

- **React 19** y **TypeScript** para la interfaz.
- **Vite 8** para desarrollo y compilación.
- **Tailwind CSS 4** para estilos.
- **shadcn/ui** y **Radix UI** para componentes.
- **Lucide React** para iconos.
- **Oxlint** para análisis estático.
- **Prettier** para formato de código.
- **pnpm** para gestión de dependencias.

## Desarrollo local

### Requisitos

- Node.js compatible con Vite 8: `20.19+` o `22.12+`.
- pnpm.
- Una o más instancias de `wireguard-api` para la futura integración con
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

Los comandos de lint fallan si encuentran errores o advertencias. Para verificar
el código sin modificar archivos:

```bash
pnpm format:check
pnpm lint:check
pnpm typecheck
```

## Estructura del proyecto

```text
src/
  app.tsx          # Componente principal
  app.css          # Estilos del componente principal
  main.tsx         # Punto de entrada
  index.css        # Estilos globales y tokens del tema
  components/ui/   # Componentes de shadcn/ui
  lib/             # Utilidades compartidas
  assets/          # Recursos del frontend
public/            # Recursos estáticos
```

El alias `@/` apunta a `src/`. Los tokens del tema están definidos en
`src/index.css`; el tema oscuro se activa con la clase `dark` en `<html>`.

Para agregar componentes de shadcn/ui:

```bash
pnpm dlx shadcn@latest add card input dialog
```
