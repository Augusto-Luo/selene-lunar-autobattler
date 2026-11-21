import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { UNIT_ORDER } from './data';
import { createUnitModel } from './models';
import { pixelateSourceCanvas } from './pixel-art-preview';
import type { UnitKind } from './types';

export function createUnitThumbnails() {
  const width = 160;
  const height = 110;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.34;
  room.dispose();
  scene.add(new THREE.HemisphereLight(0xa39bbb, 0x2b2436, 1.15));
  const key = new THREE.DirectionalLight(0xffd0a6, 3.5);
  key.position.set(-3, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.camera.left = key.shadow.camera.bottom = -5;
  key.shadow.camera.right = key.shadow.camera.top = 5;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7c80ad, 1.25);
  rim.position.set(4, 3, -4);
  scene.add(rim);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4.2, 24), new THREE.MeshStandardMaterial({ color: 0x211b2d, roughness: 0.95, metalness: 0.08 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.025;
  ground.receiveShadow = true;
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 60);
  const images = {} as Record<UnitKind, string>;
  for (const kind of UNIT_ORDER) {
    const model = createUnitModel(kind, 'player');
    model.rotation.y = -0.28;
    scene.add(model);
    if (kind === 'mech') {
      camera.position.set(5.3, 4.1, 6.5);
      camera.lookAt(0, 1.8, 0);
    } else if (kind === 'tank' || kind === 'artillery') {
      camera.position.set(5.5, 3.6, 6.3);
      camera.lookAt(0, 0.85, 0.25);
    } else if (kind === 'drone') {
      camera.position.set(3.7, 2.5, 4.2);
      camera.lookAt(0, 0.65, 0.15);
    } else {
      camera.position.set(2.65, 2.15, 3.55);
      camera.lookAt(0, 1.02, 0.18);
    }
    renderer.render(scene, camera);
    images[kind] = pixelateSourceCanvas(renderer.domElement);
    scene.remove(model);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
  }
  environment.dispose();
  pmrem.dispose();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  renderer.dispose();
  return images;
}
