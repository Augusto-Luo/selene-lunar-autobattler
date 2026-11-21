import * as THREE from 'three';
import { LunarTerrain } from './terrain';

export function createHorizonTerrain(terrain: LunarTerrain) {
  const group = new THREE.Group();
  group.name = 'horizon-details';
  let seed = 43051;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x55544f, roughness: 1, flatShading: true });
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rockMaterial, 120);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 120; i++) {
    const angle = random() * Math.PI * 2;
    const distance = 45 + random() ** 0.65 * 330;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const scale = 0.8 + random() * 4.5;
    const y = terrain.visualHeightAt(x, z);
    matrix.compose(
      new THREE.Vector3(x, y + scale * 0.15, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 0.3, random() * Math.PI, random() * 0.25)),
      new THREE.Vector3(scale, scale * (0.35 + random() * 0.5), scale * 0.8),
    );
    rocks.setMatrixAt(i, matrix);
  }
  rocks.receiveShadow = false;
  rocks.castShadow = false;
  group.add(rocks);
  return group;
}
