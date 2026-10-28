// schema/*.schema.json から ajv の検証器コードをビルド前に生成する(standalone)。
// 実行時に ajv が new Function でコンパイルしないので、CSP の script-src に 'unsafe-eval' が要らない。
// 使い方: node scripts/gen-validators.mjs          # src/validate/compiled.js を書き出す
//         node scripts/gen-validators.mjs --check  # 書き出し済みと一致するか検査(テストが使う)
import { readFileSync, writeFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';

const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const motion = read('schema/motion.schema.json');
const profile = read('schema/avatar-profile.schema.json');

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false, code: { source: true, esm: true } });
addFormats(ajv);
ajv.addSchema(motion, 'motion');
ajv.addSchema(profile, 'profile');
let code = standaloneCode(ajv, { validateMotion: 'motion', validateProfile: 'profile' });
// standalone は 2 つの runtime 依存を require で出す。ブラウザの ESM では使えないので、同じ動作の小さな実装へ置き換える
const UCS2 = 'const func1 = require("ajv/dist/runtime/ucs2length").default;';
const DATE = 'const formats0 = require("ajv-formats/dist/formats").fullFormats.date;';
if (!code.includes(UCS2) || !code.includes(DATE)) throw new Error('standalone の出力形式が想定と違う(require の置き換え先が見つからない)');
code = code
  .replace(UCS2, 'const func1 = (str) => { let length = 0; const len = str.length; let pos = 0; let value; while (pos < len) { length++; value = str.charCodeAt(pos++); if (value >= 0xd800 && value <= 0xdbff && pos < len) { value = str.charCodeAt(pos); if ((value & 0xfc00) === 0xdc00) pos++; } } return length; };')
  .replace(DATE, 'const formats0 = { validate: (str) => { const m = /^(\\d\\d\\d\\d)-(\\d\\d)-(\\d\\d)$/.exec(str); if (!m) return false; const y = +m[1]; const mo = +m[2]; const d = +m[3]; const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0); return mo >= 1 && mo <= 12 && d >= 1 && d <= (mo === 2 && leap ? 29 : [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo]); } };');
const out = `// 自動生成: node scripts/gen-validators.mjs(schema/*.schema.json から)。手で編集しない。\n// @ts-nocheck\n/* eslint-disable */\n${code}`;
const target = new URL('src/validate/compiled.js', root);
if (process.argv.includes('--check')) {
  const cur = readFileSync(target, 'utf8');
  if (cur !== out) { console.error('src/validate/compiled.js is stale: run node scripts/gen-validators.mjs'); process.exit(1); }
} else writeFileSync(target, out);
