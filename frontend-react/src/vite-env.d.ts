/// <reference types="vite/client" />

// Allow importing CSS files in TypeScript modules.
// Vite handles the actual CSS processing at build time.
declare module '*.css' {
  const content: string;
  export default content;
}
