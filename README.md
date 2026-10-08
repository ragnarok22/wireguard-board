# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

## Tailwind CSS and shadcn/ui

Tailwind CSS 4 is configured through the Vite plugin. The shadcn/ui theme and
tokens live in `src/index.css`, with the `radix-nova` style and neutral colors.
Dark theme tokens are activated by adding the `dark` class to `<html>`.
The Vite starter styles live in `src/App.css` inside a CSS layer so Tailwind
utilities can override them without changing the shadcn theme tokens.

The `@/` alias points to `src/`. The Button component is ready to use:

```tsx
import { Button } from '@/components/ui/button'

<Button className="mt-4">Connect</Button>
```

Add more components with:

```sh
pnpm dlx shadcn@latest add card input dialog
```

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
