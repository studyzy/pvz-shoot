import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Audio assets are inlined: every export in src/fx/audio.js starts as %%INJECT%% and is replaced here by
// the raw bytes of public/audio/<file> (latin-1 string, one char per byte). Inlining instead of fetching +
// decodeAudioData at runtime is what lets the first shot have sound; the anchor is spliced by index so a
// binary that happens to spell something placeholder-like cannot corrupt the module. Assets, sources,
// processing and licenses: public/audio/LICENSE-audio.txt.
// [export name in src/fx/audio.js, file under public/audio]
const AUDIO_FILES = [
  ['gun1', 'gun1.wav'], ['gun2', 'gun2.wav'], ['boom', 'boom.wav'], ['blackpowder', 'bp.wav'],
  ['z1', 'z1.wav'], ['z2', 'z2.wav'], ['z3', 'z3.wav'], ['z4', 'z4.wav'], ['z5', 'z5.wav'], ['z6', 'z6.wav'],
  ['pop1', 'pop1.wav'], ['slime', 'slime.wav'], ['slime2', 'slime2.wav'], ['splash5', 'splash5.wav'],
  ['bubble', 'bubble.wav'], ['freeze', 'freeze.wav'],
];
// B = backslash / Q = single quote / DQ = double quote, as character codes, so this file itself never has
// to talk about escaping. Any of them written out inside a template literal would re-interpret the \x
// escapes produced below (String.raw / raw inspection would break); string concatenation is immune to that.
const B = String.fromCharCode(0x5c);
const Q = String.fromCharCode(0x27);
const DQ = String.fromCharCode(0x22);
// Latin-1 string -> contents of a single-quoted JS literal (without the surrounding quotes). Everything
// outside printable ASCII becomes a hex escape: raw U+2028/U+2029 are line terminators to the parser.
const escapeLatin1 = (s) => {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x20 && c <= 0x7e) out += s[i] === B || s[i] === Q || s[i] === DQ ? B + s[i] : s[i];
    else out += B + 'x' + c.toString(16).padStart(2, '0');
  }
  return out;
};

function embedAudio() {
  return {
    name: 'embed-audio',
    // No `enforce`: vite:esbuild runs in the normal bucket before plugins without enforce, and it is
    // what parses the source; the %%INJECT%% anchor below is a harmless placeholder when it arrives there.
    transform(code, id) {
      if (!id.endsWith('src/fx/audio.js')) return null;
      let out = code;
      for (const [exportName, file] of AUDIO_FILES) {
        const raw = readFileSync(resolve(ROOT, 'public/audio', file)).toString('latin1');
        // The file is spliced in by index, never through String.prototype.replace: sample bytes can spell
        // any substring (the $-patterns of replace() especially), and index-based assignment cannot care.
        const anchor = 'export const ' + exportName + ' = %%INJECT%%;';
        const at = out.indexOf(anchor);
        if (at < 0) throw new Error('embed-audio: missing anchor for ' + exportName + ' in src/fx/audio.js');
        out = out.slice(0, at) + 'export const ' + exportName + ' = ' + Q + escapeLatin1(raw) + Q + ';' + out.slice(at + anchor.length);
      }
      return { code: out, map: null };
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [embedAudio()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2019',
    assetsInlineLimit: 4096,
  },
});
