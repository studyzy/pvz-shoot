// Third-party CC0 sound effects (WAV, 22.05 kHz, mono, PCM). Each export's value is filled in at build
// time by the embed-audio plugin in vite.config.js / vitest.config.js, which reads public/audio/<file>
// and sets the export to a latin-1 string of its raw bytes; Sfx.decodeWav decodes the PCM directly.
// Embedding (instead of fetching at runtime) is what lets the first shot have sound: fetch is async and
// the buffer often arrives a beat too late.
// To replace a sound edit the files under public/audio/ (see LICENSE-audio.txt), not this file. If the
// plugin did not run (values stay ''), Sfx skips the sample and falls back to pure synthesis.
export const gun1 = %%INJECT%%;
export const gun2 = %%INJECT%%;
export const boom = %%INJECT%%;
export const blackpowder = %%INJECT%%;
export const z1 = %%INJECT%%;
export const z2 = %%INJECT%%;
export const z3 = %%INJECT%%;
export const z4 = %%INJECT%%;
export const z5 = %%INJECT%%;
export const z6 = %%INJECT%%;
export const pop1 = %%INJECT%%;
export const slime = %%INJECT%%;
export const slime2 = %%INJECT%%;
export const splash5 = %%INJECT%%;
export const bubble = %%INJECT%%;
export const freeze = %%INJECT%%;
