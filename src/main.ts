import * as THREE from 'three';
import motionJson from '../samples/arigatou.motion.json';
import { validateMotion } from './validate';

// Phase 0 プレースホルダ: 両手を球+箱で表示するだけ。モード名は「指文字/身振り支援」。
const result = validateMotion(motionJson);
if (!result.ok) throw new Error(`sample motion invalid: ${result.errors.join('; ')}`);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a22);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 10);
camera.position.set(0, 0, 1.2);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const light = new THREE.DirectionalLight(0xffffff, 1.2);
light.position.set(1, 2, 3);
scene.add(light);

function placeholderHand(x: number, color: number): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.02), new THREE.MeshStandardMaterial({ color })));
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06), new THREE.MeshStandardMaterial({ color }));
    f.position.set(-0.03 + i * 0.015, 0.075, 0);
    g.add(f);
  }
  g.position.x = x;
  return g;
}
const left = placeholderHand(-0.15, 0x6fa8dc);
const right = placeholderHand(0.15, 0xf6b26b);
scene.add(left, right);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop((t) => {
  right.rotation.z = Math.sin(t / 500) * 0.2;
  renderer.render(scene, camera);
});
