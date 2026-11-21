import * as THREE from 'three';

interface BastionObstacle {
  x: number;
  z: number;
  r: number;
  h: number;
  visual: false;
}

type HeightAt = (x: number, z: number) => number;

/** A broad, manufactured fortress: curtain walls, four towers, a command keep and five assault routes. */
export function buildBastionEnvironment(heightAt: HeightAt) {
  const group = new THREE.Group();
  group.name = 'bastion-fortress';
  const obstacles: BastionObstacle[] = [];
  const scale = 1.15;
  const scaleX = (x: number) => x * scale;
  const scaleZ = (z: number) => 28 + (z - 28) * scale;

  const concrete = new THREE.MeshStandardMaterial({ color: 0x7b8182, roughness: 0.88, metalness: 0.18 });
  const armor = new THREE.MeshStandardMaterial({ color: 0x59676d, roughness: 0.62, metalness: 0.66 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x242c35, roughness: 0.8, metalness: 0.46 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xc49a4c, roughness: 0.66, metalness: 0.34 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x6fc5c6, emissive: 0x1e5d64, emissiveIntensity: 0.9, roughness: 0.34, metalness: 0.5 });

  const place = <T extends THREE.Object3D>(object: T, x: number, y: number, z: number) => {
    const previousGround = heightAt(x, z);
    const worldX = scaleX(x);
    const worldZ = scaleZ(z);
    object.position.set(worldX, heightAt(worldX, worldZ) + y - previousGround, worldZ);
    object.scale.x *= scale;
    object.scale.z *= scale;
    object.castShadow = object.receiveShadow = true;
    group.add(object);
    return object;
  };
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, material = concrete) =>
    place(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material), x, y, z);
  const addCylinder = (radiusTop: number, radiusBottom: number, height: number, segments: number, x: number, y: number, z: number, material = armor) =>
    place(new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material), x, y, z);
  const obstacle = (x: number, z: number, r: number, h: number) => obstacles.push({ x: scaleX(x), z: scaleZ(z), r: r * scale, h, visual: false });
  const groundPlane = (w: number, d: number, x: number, z: number, material: THREE.Material, offset = 0.055) => {
    const centerX = scaleX(x);
    const centerZ = scaleZ(z);
    const geometry = new THREE.PlaneGeometry(w * scale, d * scale, Math.max(1, Math.round(w)), Math.max(1, Math.round(d)));
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const worldX = positions.getX(i) + centerX;
      const worldZ = positions.getZ(i) + centerZ;
      positions.setY(i, heightAt(worldX, worldZ) + offset);
    }
    geometry.computeVertexNormals();
    const object = new THREE.Mesh(geometry, material);
    object.position.set(centerX, 0, centerZ);
    object.receiveShadow = true;
    group.add(object);
    return object;
  };

  // The terrain supplies a perfectly level engineered courtyard. These horizontal
  // surfaces and straight seams must never inherit the former mound's curvature.
  groundPlane(37, 23, 0, 16.75, concrete);
  groundPlane(5, 58, 0, 1, dark, 0.07);
  groundPlane(35, 4, 0, 14, dark, 0.075);
  for (let x = -16; x <= 16; x += 4) groundPlane(0.055, 22, x, 16.5, dark, 0.082);
  for (let z = 7; z <= 27; z += 4) groundPlane(36, 0.055, 0, z, dark, 0.084);
  for (let z = -26; z <= 28; z += 4) addBox(0.16, 0.035, 1.6, 0, heightAt(0, z) + 0.105, z, accent);

  const wallLine = (x1: number, z1: number, x2: number, z2: number, height = 1.55) => {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.max(1, Math.ceil(length / 1.25));
    const angle = Math.atan2(-(z2 - z1), x2 - x1);
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const x = THREE.MathUtils.lerp(x1, x2, t);
      const z = THREE.MathUtils.lerp(z1, z2, t);
      const y = heightAt(x, z);
      const blockLength = length / steps + 0.045;
      const foundation = addBox(blockLength, 0.48, 1.02, x, y + 0.12, z, dark);
      foundation.rotation.y = angle;
      const body = addBox(blockLength, height, 0.72, x, y + 0.48 + height / 2, z, concrete);
      body.rotation.y = angle;
      const cap = addBox(blockLength + 0.05, 0.16, 0.88, x, y + 0.48 + height + 0.08, z, armor);
      cap.rotation.y = angle;
      if (i % 2 === 0) {
        const merlon = addBox(blockLength * 0.58, 0.34, 0.76, x, y + 0.48 + height + 0.31, z, armor);
        merlon.rotation.y = angle;
      }
      if (i % 3 === 1) {
        const marker = addBox(blockLength * 0.48, 0.12, 0.755, x, y + 0.78, z, accent);
        marker.rotation.y = angle;
      }
      obstacle(x, z, 0.64, height + 0.5);
    }
  };

  // Two northern breaches flank the solid keep; the south and side gates remain independent.
  wallLine(-15.2, 5.5, -12, 5.5, 2.1);
  wallLine(-8, 5.5, -4, 5.5, 2.1);
  wallLine(4, 5.5, 8, 5.5, 2.1);
  wallLine(12, 5.5, 15.2, 5.5, 2.1);
  // Lower near walls preserve a view into the courtyard from the tactical camera.
  wallLine(-15.2, 27.5, -3.2, 27.5, 1.15);
  wallLine(3.2, 27.5, 15.2, 27.5, 1.15);
  for (const x of [-18, 18]) {
    wallLine(x, 6.4, x, 11.4, x < 0 ? 2.1 : 1.35);
    wallLine(x, 16.6, x, 24.8, x < 0 ? 2.1 : 1.35);
  }

  const gate = (x: number, z: number, width: number, facing: 'north' | 'south') => {
    const y = heightAt(x, z);
    for (const side of [-1, 1]) {
      const postX = x + side * width / 2;
      addBox(0.62, 2.55, 1.18, postX, y + 1.275, z, armor);
      addBox(0.76, 0.22, 1.3, postX, y + 2.62, z, accent);
      obstacle(postX, z, 0.48, 2.55);
    }
    addBox(width + 0.62, 0.5, 1.12, x, y + 2.72, z, dark);
    addBox(width - 0.7, 0.12, 0.08, x, y + 2.73, z + (facing === 'south' ? 0.61 : -0.61), glass);
  };
  gate(-10, 5.5, 4, 'north');
  gate(10, 5.5, 4, 'north');
  gate(0, 5.5, 7.2, 'north');
  gate(0, 27.5, 5.6, 'south');

  const tower = (x: number, z: number, height: number) => {
    const y = heightAt(x, z);
    addCylinder(1.85, 2.05, 0.55, 8, x, y + 0.275, z, dark);
    addCylinder(1.55, 1.78, height, 8, x, y + 0.55 + height / 2, z, concrete);
    addCylinder(1.82, 1.82, 0.28, 8, x, y + 0.55 + height, z, armor);
    addCylinder(1.32, 1.5, 0.6, 8, x, y + 0.55 + height + 0.42, z, dark);
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * Math.PI * 2;
      const px = x + Math.sin(angle) * 1.61;
      const pz = z + Math.cos(angle) * 1.61;
      const slit = addBox(0.36, 0.2, 0.07, px, y + height * 0.72, pz, i % 2 ? glass : dark);
      slit.rotation.y = angle;
    }
    obstacle(x, z, 1.82, height + 0.8);
  };
  tower(-15.5, 7, 3.7);
  tower(15.5, 7, 3.7);
  tower(-15.5, 24.5, 3.25);
  tower(15.5, 24.5, 3.25);

  const gun = (x: number, z: number, heading: number) => {
    const y = heightAt(x, z);
    addCylinder(1.1, 1.28, 0.45, 10, x, y + 0.225, z, dark);
    addCylinder(0.76, 0.92, 0.82, 10, x, y + 0.82, z, armor);
    const yoke = addBox(1.25, 0.38, 0.8, x, y + 1.32, z, dark);
    yoke.rotation.y = heading;
    for (const side of [-1, 1]) {
      const barrel = addCylinder(0.085, 0.085, 2.8, 8, x + side * 0.27, y + 1.48, z, dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.rotation.y = heading;
      barrel.position.x += Math.sin(heading) * 1.25;
      barrel.position.z += Math.cos(heading) * 1.25;
    }
    addBox(0.74, 0.12, 0.1, x, y + 1.06, z + 0.81, accent);
    obstacle(x, z, 1.08, 1.55);
  };
  gun(-8, 7.5, Math.PI);
  gun(8, 7.5, Math.PI);

  // Buttresses reinforce the manufactured silhouette without occupying gate lanes.
  for (const x of [-14, -6, 6, 14]) {
    const y = heightAt(x, 5.5);
    addBox(.52, 2.3, 1.18, x, y + 1.15, 5.5, armor);
    addBox(.62, .22, 1.26, x, y + 2.4, 5.5, accent);
  }

  // Recessed service pads distinguish a garrison yard from the relay's road network.
  for (const x of [-8.4, 8.4]) {
    groundPlane(8, 5.4, x, 20.5, armor, .065);
    for (const side of [-1, 1]) groundPlane(.13, 4.7, x + side * 3.4, 20.5, accent, .085);
    groundPlane(6.8, .13, x, 22.85, accent, .085);
  }

  // The northern keep anchors the silhouette without hiding the defenders in the courtyard.
  const keepX = 0;
  const keepZ = 7.5;
  const keepY = heightAt(keepX, keepZ);
  addBox(8.2, 0.52, 6.4, keepX, keepY + 0.26, keepZ, dark);
  addBox(7.4, 2.5, 5.6, keepX, keepY + 1.77, keepZ, concrete);
  addBox(7.9, 0.3, 6.0, keepX, keepY + 3.17, keepZ, armor);
  addBox(5.0, 1.35, 3.8, keepX, keepY + 3.99, keepZ + 0.35, armor);
  addBox(5.5, 0.24, 4.25, keepX, keepY + 4.79, keepZ + 0.35, dark);
  addBox(2.05, 2.15, 0.12, keepX, keepY + 1.58, keepZ + 2.86, dark);
  for (const side of [-1, 1]) addBox(0.22, 2.45, 0.24, keepX + side * 1.22, keepY + 1.72, keepZ + 2.94, accent);
  addBox(2.7, 0.22, 0.24, keepX, keepY + 2.96, keepZ + 2.94, accent);
  for (const x of [-2.55, -1.25, 1.25, 2.55]) addBox(0.72, 0.28, 0.1, keepX + x, keepY + 2.35, keepZ + 2.87, glass);
  for (const x of [-1.55, 0, 1.55]) addBox(0.82, 0.25, 0.1, keepX + x, keepY + 4.08, keepZ + 2.29, glass);
  for (const x of [-2.4, 0, 2.4]) for (const z of [keepZ - 1.8, keepZ + 1.8]) obstacle(x, z, 1.4, 3.8);

  const roofY = keepY + 4.92;
  addCylinder(0.13, 0.2, 2.8, 10, keepX, roofY + 1.4, keepZ + 0.35, armor);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.35, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.38), armor);
  dish.scale.y = 0.34;
  dish.rotation.x = -0.72;
  place(dish, keepX, roofY + 2.95, keepZ + 0.35);
  addCylinder(0.07, 0.07, 1.4, 8, keepX, roofY + 3.25, keepZ + 0.35, accent).rotation.x = -0.72;

  // Exterior service blocks make the perimeter read as a working military installation.
  for (const [x, z] of [[-15.8, 19.5], [15.8, 19.5]] as const) {
    const y = heightAt(x, z);
    addBox(1.55, 1.25, 2.1, x, y + 0.625, z, armor);
    addBox(1.72, 0.18, 2.25, x, y + 1.34, z, dark);
    for (let i = -2; i <= 2; i++) addBox(0.09, 0.85, 0.08, x + i * 0.22, y + 0.62, z + 1.08, dark);
    addBox(0.82, 0.12, 0.08, x, y + 0.42, z + 1.1, accent);
    obstacle(x, z, 1.02, 1.45);
  }

  return { group, obstacles };
}
