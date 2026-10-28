// 自作の最小テスト用 VRM 1.0(棒人間)を生成する。第三者アバターの資産は一切使わない。
//   node scripts/make-fixture-vrm.mjs           -> fixtures/stick-figure.vrm / stick-figure-no-fingers.vrm を書き出す
//   node scripts/make-fixture-vrm.mjs --check   -> 生成結果が書き出し済みファイルと一致するか検査(不一致は終了コード1)
// 仕様: VRM 1.0(VRMC_vrm 1.0)。T-pose、+Z が正面、キャラクターの left は +X。
//   全 humanoid ボーン(55個)を持つ版と、指ボーン(30個)を欠く版を作る。各ボーンに薄い箱メッシュを付ける(スキンなし)。
//   手のひらが分かるように、手の箱は厚み(y)だけ薄くしてある。
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];

// [name, parent, local translation (T-pose, 右側は x を反転して作る)]
function boneTable() {
  const t = [
    ['hips', null, [0, 0.95, 0]],
    ['spine', 'hips', [0, 0.1, 0]],
    ['chest', 'spine', [0, 0.12, 0]],
    ['upperChest', 'chest', [0, 0.12, 0]],
    ['neck', 'upperChest', [0, 0.12, 0]],
    ['head', 'neck', [0, 0.08, 0]],
    ['jaw', 'head', [0, 0.03, 0.05]],
  ];
  for (const [side, sx] of [['left', 1], ['right', -1]]) {
    const S = side;
    const P = (n) => `${S}${n}`;
    t.push(
      [P('Eye'), 'head', [0.03 * sx, 0.08, 0.08]],
      [P('Shoulder'), 'upperChest', [0.03 * sx, 0.08, 0]],
      [P('UpperArm'), P('Shoulder'), [0.17 * sx, 0, 0]],
      [P('LowerArm'), P('UpperArm'), [0.28 * sx, 0, 0]],
      [P('Hand'), P('LowerArm'), [0.26 * sx, 0, 0]],
      [P('UpperLeg'), 'hips', [0.08 * sx, -0.05, 0]],
      [P('LowerLeg'), P('UpperLeg'), [0, -0.42, 0]],
      [P('Foot'), P('LowerLeg'), [0, -0.42, 0]],
      [P('Toes'), P('Foot'), [0, -0.05, 0.12]],
    );
    // 指(母指は Metacarpal/Proximal/Distal、他は Proximal/Intermediate/Distal)。z は母指=前、小指=後ろへ並べる
    const fingers = [
      ['Thumb', [['Metacarpal', [0.02, 0, 0.02]], ['Proximal', [0.03, 0, 0.02]], ['Distal', [0.025, 0, 0.015]]]],
      ['Index', [['Proximal', [0.08, 0, 0.03]], ['Intermediate', [0.035, 0, 0]], ['Distal', [0.025, 0, 0]]]],
      ['Middle', [['Proximal', [0.085, 0, 0.01]], ['Intermediate', [0.04, 0, 0]], ['Distal', [0.027, 0, 0]]]],
      ['Ring', [['Proximal', [0.08, 0, -0.01]], ['Intermediate', [0.036, 0, 0]], ['Distal', [0.025, 0, 0]]]],
      ['Little', [['Proximal', [0.07, 0, -0.03]], ['Intermediate', [0.028, 0, 0]], ['Distal', [0.02, 0, 0]]]],
    ];
    for (const [f, segs] of fingers) {
      let parent = P('Hand');
      for (const [seg, v] of segs) {
        const name = `${S}${f}${seg}`;
        t.push([name, parent, [v[0] * sx, v[1], v[2]]]);
        parent = name;
      }
    }
  }
  return t;
}

const isFinger = (name) => FINGER_NAMES.some((f) => name.includes(f));

// 単位立方体(中心原点)。24頂点(面ごとに法線)
function boxGeometry() {
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  const pos = [], nor = [], idx = [];
  faces.forEach(([n, vs], i) => {
    for (const v of vs) { pos.push(v[0] / 2, v[1] / 2, v[2] / 2); nor.push(...n); }
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint16Array(idx) };
}

const pad4 = (buf, fill) => (buf.length % 4 === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4), fill)]));

export function buildFixtureGlb(variant) {
  const withFingers = variant !== 'no-fingers';
  const table = boneTable().filter(([name]) => withFingers || !isFinger(name));
  const names = table.map(([n]) => n);
  const children = new Map(names.map((n) => [n, []]));
  for (const [n, p] of table) if (p) children.get(p).push(n);

  const g = boxGeometry();
  const bin = pad4(Buffer.concat([Buffer.from(g.pos.buffer), Buffer.from(g.nor.buffer), Buffer.from(g.idx.buffer)]), 0);
  const nodes = [];
  const nodeIndex = new Map();
  // ボーンノードを先に並べる(index = 表の順)
  names.forEach((n, i) => nodeIndex.set(n, i));
  for (const [name, , tr] of table) nodes.push({ name, translation: tr, children: [] });
  for (const [n, p] of table) if (p) nodes[nodeIndex.get(p)].children.push(nodeIndex.get(n));

  // 各ボーンに箱メッシュ(子ボーン方向へ伸ばす。子がなければ親方向の向きで短く)
  const mat = (n) => (n.startsWith('left') ? 0 : n.startsWith('right') ? 1 : 2);
  for (const [name, parent, tr] of table) {
    const kids = children.get(name);
    let dir = [0, 0, 0];
    if (kids.length) {
      const k = table.find(([n]) => n === kids[0])[2]; // 先頭の子へ(母指側ではなく中指側を優先したいが、見た目用なので簡易)
      dir = k;
    } else {
      dir = tr.map((v) => v * 0.5);
    }
    const len = Math.max(0.03, Math.hypot(...dir));
    const dominant = dir.map(Math.abs).indexOf(Math.max(...dir.map(Math.abs)));
    const thick = name.endsWith('Hand') ? [0.09, 0.012, 0.09] : isFinger(name) ? [0.012, 0.012, 0.012] : [0.04, 0.04, 0.04];
    const scale = thick.slice();
    if (name.endsWith('Hand')) scale[0] = 0.09; // 手の箱: 長さ(x)=手のひらの長さ、厚み(y)=薄い、幅(z)
    else scale[dominant] = len * 0.95;
    const meshNode = { name: `${name}_seg`, mesh: mat(name), translation: dir.map((v) => v / 2), scale };
    if (name.endsWith('Hand')) meshNode.translation = [0.045 * Math.sign(dir[0] || (name.startsWith('left') ? 1 : -1)), 0, 0];
    nodes.push(meshNode);
    nodes[nodeIndex.get(name)].children.push(nodes.length - 1);
  }

  const humanBones = {};
  for (const n of names) humanBones[n] = { node: nodeIndex.get(n) };
  const gltf = {
    asset: { version: '2.0', generator: 'hand-emotion scripts/make-fixture-vrm.mjs' },
    extensionsUsed: ['VRMC_vrm'],
    scene: 0,
    scenes: [{ nodes: [nodeIndex.get('hips')] }],
    nodes,
    meshes: [0, 1, 2].map((m) => ({ name: `seg${m}`, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: m }] })),
    materials: [
      { name: 'left', pbrMetallicRoughness: { baseColorFactor: [0.35, 0.6, 0.95, 1], metallicFactor: 0, roughnessFactor: 1 } },
      { name: 'right', pbrMetallicRoughness: { baseColorFactor: [0.95, 0.6, 0.3, 1], metallicFactor: 0, roughnessFactor: 1 } },
      { name: 'center', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.82, 1], metallicFactor: 0, roughnessFactor: 1 } },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: g.pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: g.pos.byteLength, byteLength: g.nor.byteLength, target: 34962 },
      { buffer: 0, byteOffset: g.pos.byteLength + g.nor.byteLength, byteLength: g.idx.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
    extensions: {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: {
          name: withFingers ? 'hand-emotion stick figure' : 'hand-emotion stick figure (no fingers)',
          version: '1.0',
          authors: ['hand-emotion'],
          licenseUrl: 'https://vrm.dev/licenses/1.0/',
          avatarPermission: 'everyone',
          allowExcessivelyViolentUsage: false,
          allowExcessivelySexualUsage: false,
          commercialUsage: 'personalNonProfit',
          allowPoliticalOrReligiousUsage: false,
          allowAntisocialOrHateUsage: false,
          creditNotation: 'unnecessary',
          allowRedistribution: true,
          modification: 'allowModification',
        },
        humanoid: { humanBones },
      },
    },
  };
  const json = pad4(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const total = 12 + 8 + json.length + 8 + bin.length;
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'ascii');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.write(type, 4, 'ascii');
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([head, chunk('JSON', json), chunk('BIN\0', bin)]);
}

const OUT = { full: 'stick-figure.vrm', 'no-fingers': 'stick-figure-no-fingers.vrm' };
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  let bad = false;
  if (!check) mkdirSync(dir, { recursive: true });
  for (const [variant, file] of Object.entries(OUT)) {
    const buf = buildFixtureGlb(variant);
    const path = join(dir, file);
    if (check) {
      let same = false;
      try { same = readFileSync(path).equals(buf); } catch { same = false; }
      if (!same) { console.error(`NG: ${file} が生成結果と一致しない`); bad = true; } else console.log(`OK: ${file}`);
    } else {
      writeFileSync(path, buf);
      console.log(`wrote ${path} (${buf.length} bytes)`);
    }
  }
  if (bad) process.exit(1);
}
