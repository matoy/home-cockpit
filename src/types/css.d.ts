// Ambient declaration for global CSS side-effect imports (e.g. `import './globals.css'`).
// Required when TypeScript's `noUncheckedSideEffectImports` is enabled (default in TS 6+)
// because Next.js 15's `next/types/global.d.ts` only declares `*.module.css`.
declare module '*.css' {}
