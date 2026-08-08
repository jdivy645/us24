// The US24 Solutions wordmark as a base64 data URI.
//
// Held in a .js module rather than a file in public/ so it needs no Vite asset
// config or fetch, works identically in doc.addImage() and <img src>, and stays
// importable from node --test.
//
// TO SET: export the logo at roughly 680x176px (4x its ~170x44pt print size),
// base64-encode it, and paste the full "data:image/png;base64,..." string below.
// While this is empty both renderers fall back to drawing the wordmark in type,
// which is legible but is not the client's actual mark.
export const LOGO_PNG = "";
