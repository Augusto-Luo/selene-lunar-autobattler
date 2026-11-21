import * as THREE from 'three';
import type { BattleRenderer } from './renderer';

export const PIXEL_PALETTE = [
  [5, 6, 13], [11, 12, 24], [22, 20, 39], [38, 32, 56], [57, 47, 70],
  [80, 65, 83], [107, 88, 96], [137, 113, 105], [163, 142, 119], [190, 172, 143],
  [216, 200, 167], [239, 225, 193], [70, 91, 105], [105, 134, 142], [148, 177, 176],
  [191, 211, 201], [20, 57, 67], [43, 137, 149], [137, 220, 213], [103, 57, 34],
  [211, 139, 65], [255, 213, 137], [83, 34, 38], [184, 74, 61], [242, 144, 105],
] as const;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const DITHER_STRENGTH = 0.28;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const paletteShader = PIXEL_PALETTE.slice(0, -1).map(([r, g, b], index) =>
  `    if (index == ${index}) return vec3(${r.toFixed(1)}, ${g.toFixed(1)}, ${b.toFixed(1)}) / 255.0;`,
).join('\n');
const lastPaletteColor = PIXEL_PALETTE[PIXEL_PALETTE.length - 1];

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform float uNear;
  uniform float uFar;
  uniform float uExposure;

  float bayer4(vec2 point) {
    int x = int(mod(floor(point.x), 4.0));
    int y = int(mod(floor(point.y), 4.0));
    float value = 0.0;
    if (y == 0) {
      if (x == 0) value = 0.0;
      else if (x == 1) value = 8.0;
      else if (x == 2) value = 2.0;
      else value = 10.0;
    } else if (y == 1) {
      if (x == 0) value = 12.0;
      else if (x == 1) value = 4.0;
      else if (x == 2) value = 14.0;
      else value = 6.0;
    } else if (y == 2) {
      if (x == 0) value = 3.0;
      else if (x == 1) value = 11.0;
      else if (x == 2) value = 1.0;
      else value = 9.0;
    } else {
      if (x == 0) value = 15.0;
      else if (x == 1) value = 7.0;
      else if (x == 2) value = 13.0;
      else value = 5.0;
    }
    return (value + 0.5) / 16.0;
  }

  vec3 paletteAt(int index) {
${paletteShader}
    return vec3(${lastPaletteColor[0].toFixed(1)}, ${lastPaletteColor[1].toFixed(1)}, ${lastPaletteColor[2].toFixed(1)}) / 255.0;
  }

  vec3 acesFilm(vec3 value) {
    return clamp((value * (2.51 * value + 0.03)) / (value * (2.43 * value + 0.59) + 0.14), 0.0, 1.0);
  }

  vec3 linearToSrgb(vec3 value) {
    vec3 low = value * 12.92;
    vec3 high = 1.055 * pow(max(value, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(low, high, step(vec3(0.0031308), value));
  }

  vec3 splitTone(vec3 color) {
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float warm = smoothstep(0.22, 0.68, luminance);
    vec3 grade = mix(vec3(0.94, 0.96, 1.06), vec3(1.12, 1.04, 0.92), warm);
    return clamp(color * grade, 0.0, 1.0);
  }

  vec3 quantizePalette(vec3 color, vec2 pixel) {
    float nearest = 100000.0;
    float second = 100000.0;
    vec3 nearestColor = vec3(0.0);
    vec3 secondColor = vec3(0.0);
    for (int index = 0; index < ${PIXEL_PALETTE.length}; index++) {
      vec3 candidate = paletteAt(index);
      vec3 delta = color - candidate;
      float distanceToColor = dot(delta * delta, vec3(0.30, 0.48, 0.22));
      if (distanceToColor < nearest) {
        second = nearest;
        secondColor = nearestColor;
        nearest = distanceToColor;
        nearestColor = candidate;
      } else if (distanceToColor < second) {
        second = distanceToColor;
        secondColor = candidate;
      }
    }
    float ratio = clamp(nearest / max(nearest + second, 0.00001), 0.0, 1.0) * ${DITHER_STRENGTH.toFixed(2)};
    return bayer4(pixel) < ratio ? secondColor : nearestColor;
  }

  float linearDepth(vec2 uv) {
    float depth = texture2D(tDepth, uv).x;
    return (uNear * uFar) / max(0.00001, uFar - depth * (uFar - uNear));
  }

  void main() {
    vec3 linearColor = texture2D(tColor, vUv).rgb;
    vec3 color = splitTone(linearToSrgb(acesFilm(linearColor * uExposure)));
    vec2 pixel = floor(vUv * uResolution);
    color = quantizePalette(color, pixel);

    vec2 texel = 1.0 / uResolution;
    float depth = linearDepth(vUv);
    float threshold = max(0.26, depth * 0.015);
    float leftDepth = linearDepth(vUv - vec2(texel.x, 0.0));
    float rightDepth = linearDepth(vUv + vec2(texel.x, 0.0));
    float downDepth = linearDepth(vUv - vec2(0.0, texel.y));
    float upDepth = linearDepth(vUv + vec2(0.0, texel.y));
    bool silhouette = depth < leftDepth - threshold || depth < rightDepth - threshold || depth < downDepth - threshold || depth < upDepth - threshold;
    if (silhouette && depth < uFar * 0.48) color = mix(color, paletteAt(0), 0.82);

    gl_FragColor = vec4(color, 1.0);
  }
`;

class PixelArtPipeline {
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private width = 0;
  private height = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly renderDirect: THREE.WebGLRenderer['render']) {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 },
        uFar: { value: 2000 },
        uExposure: { value: 1.12 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  resize(width: number, height: number) {
    const internalHeight = Math.max(1, Math.min(360, Math.round(height)));
    const internalWidth = Math.max(1, Math.round(internalHeight * width / Math.max(1, height)));
    if (internalWidth === this.width && internalHeight === this.height) return;
    this.width = internalWidth;
    this.height = internalHeight;
    this.target?.dispose();
    const target = new THREE.WebGLRenderTarget(internalWidth, internalHeight, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: this.renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    target.depthTexture = new THREE.DepthTexture(internalWidth, internalHeight, THREE.UnsignedIntType);
    target.depthTexture.format = THREE.DepthFormat;
    target.samples = 0;
    this.target = target;
    this.material.uniforms.tColor.value = target.texture;
    this.material.uniforms.tDepth.value = target.depthTexture;
    this.material.uniforms.uResolution.value.set(internalWidth, internalHeight);
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.target) return;
    const perspective = camera as THREE.PerspectiveCamera;
    this.material.uniforms.uNear.value = perspective.near ?? 0.1;
    this.material.uniforms.uFar.value = perspective.far ?? 2000;
    this.renderer.setRenderTarget(this.target);
    this.renderDirect(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderDirect(this.postScene, this.postCamera);
  }
}

/** Quantizes the procedural unit portraits with the same palette as the battlefield. */
export function pixelateSourceCanvas(source: HTMLCanvasElement) {
  const output = document.createElement('canvas');
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, output.width, output.height);
  const data = image.data;
  for (let y = 0; y < output.height; y++) {
    for (let x = 0; x < output.width; x++) {
      const offset = (y * output.width + x) * 4;
      if (data[offset + 3] < 128) {
        data[offset + 3] = 0;
        continue;
      }
      let nearest = Number.POSITIVE_INFINITY;
      let second = Number.POSITIVE_INFINITY;
      let nearestColor: readonly [number, number, number] = PIXEL_PALETTE[0];
      let secondColor: readonly [number, number, number] = PIXEL_PALETTE[0];
      for (const candidate of PIXEL_PALETTE) {
        const red = data[offset] - candidate[0];
        const green = data[offset + 1] - candidate[1];
        const blue = data[offset + 2] - candidate[2];
        const distance = red * red * 0.30 + green * green * 0.48 + blue * blue * 0.22;
        if (distance < nearest) {
          second = nearest;
          secondColor = nearestColor;
          nearest = distance;
          nearestColor = candidate;
        } else if (distance < second) {
          second = distance;
          secondColor = candidate;
        }
      }
      const threshold = (BAYER4[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
      const ratio = nearest / Math.max(0.00001, nearest + second) * DITHER_STRENGTH;
      const color = threshold < ratio ? secondColor : nearestColor;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return output.toDataURL('image/png');
}

/** Canonical art treatment used by both the game and the level editor. */
export function installPixelArtPreview(view: BattleRenderer) {
  const renderer = view.renderer;
  const renderDirect = renderer.render.bind(renderer);
  const setSizeDirect = renderer.setSize.bind(renderer);
  const pipeline = new PixelArtPipeline(renderer, renderDirect);

  renderer.setPixelRatio(1);
  renderer.toneMappingExposure = 1;
  renderer.render = ((scene: THREE.Scene, camera: THREE.Camera) => pipeline.render(scene, camera)) as THREE.WebGLRenderer['render'];
  renderer.setSize = ((width: number, height: number, updateStyle?: boolean) => {
    setSizeDirect(width, height, updateStyle);
    pipeline.resize(width, height);
  }) as THREE.WebGLRenderer['setSize'];

  view.scene.background = new THREE.Color(0x03030a);
  view.scene.fog = new THREE.FogExp2(0x0b0815, 0.00165);
  view.scene.environmentIntensity = 0.18;
  view.scene.traverse(object => {
    if (object instanceof THREE.HemisphereLight) {
      object.color.set(0xa39bbb);
      object.groundColor.set(0x2b2436);
      object.intensity = 1.12;
    } else if (object instanceof THREE.DirectionalLight) {
      object.color.set(0xffd0a6);
      object.intensity = 4.05;
      object.position.set(-32, 22, 16);
    } else if (object instanceof THREE.LineSegments) {
      const material = object.material as THREE.LineBasicMaterial;
      if (material.color.getHex() === 0x4fc1c8) {
        material.color.set(0x3f7c84);
        material.opacity = 0.14;
      }
    }
  });

  setSizeDirect(view.container.clientWidth, view.container.clientHeight, false);
  pipeline.resize(view.container.clientWidth, view.container.clientHeight);
}
