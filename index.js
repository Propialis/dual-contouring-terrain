import metaversefile from 'metaversefile';
import * as THREE from 'three';
// import { terrainVertex, terrainFragment } from './shaders/terrainShader.js';
import biomeSpecs from './biomes.js';

const {useApp, useLocalPlayer, useFrame, useCleanup, usePhysics, useLoaders, useInstancing, useDcWorkerManager, useLodder} = metaversefile;

const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localMatrix = new THREE.Matrix4();
const localMatrix2 = new THREE.Matrix4();
// const localColor = new THREE.Color();
const localSphere = new THREE.Sphere();

const dcWorkerManager = useDcWorkerManager();
const chunkWorldSize = dcWorkerManager.chunkSize;
const chunkRadius = Math.sqrt(chunkWorldSize * chunkWorldSize * 3);
const numLods = 1;
const bufferSize = 20 * 1024 * 1024;

// const textureLoader = new THREE.TextureLoader();
const abortError = new Error('chunk disposed');
const fakeMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
});

const mapNames = [
  'Base_Color',
  'Height',
  'Normal',
  'Roughness',
  'Emissive',
  'Ambient_Occlusion',
];
const biomesPngTexturePrefix = `/images/stylized-textures/png/`;
const biomesKtx2TexturePrefix = `https://webaverse.github.io/land-textures/`;
const neededTexturePrefixes = (() => {
  const neededTexturePrefixesSet = new Set();
  for (const biomeSpec of biomeSpecs) {
    const [name, colorHex, textureName] = biomeSpec;
    neededTexturePrefixesSet.add(textureName);
  }
  const neededTexturePrefixes = Array.from(neededTexturePrefixesSet);
  return neededTexturePrefixes;
})();
const texturesPerRow = Math.ceil(Math.sqrt(neededTexturePrefixes.length));

const loadImage = u => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    resolve(img);
  };
  img.onerror = err => {
    if (/Emissive/i.test(u)) {
      const blankCanvas = document.createElement('canvas');
      blankCanvas.width = 1;
      blankCanvas.height = 1;
      resolve(blankCanvas);
    } else {
      reject(err);
    }
  };
  img.crossOrigin = 'Anonymous';
  img.src = u;
});
function downloadFile(file, filename) {
  const blobURL = URL.createObjectURL(file);
  const tempLink = document.createElement('a');
  tempLink.style.display = 'none';
  tempLink.href = blobURL;
  tempLink.setAttribute('download', filename);

  document.body.appendChild(tempLink);
  tempLink.click();
  document.body.removeChild(tempLink);
}
const bakeBiomesAtlas = async ({
  size = 8 * 1024,
} = {}) => {
  const atlasTextures = [];
  const textureTileSize = size / texturesPerRow;
  const halfTextureTileSize = textureTileSize / 2;

  for (const mapName of mapNames) {
    const neededTextureNames = neededTexturePrefixes.map(prefix => `${prefix}${mapName}`);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    document.body.appendChild(canvas);
    canvas.style.cssText = `\
      position: fixed;
      top: 0;
      left: 0;
      z-index: 100;
      width: 1024px;
      height: 1024px;
    `;

    let index = 0;
    for (const textureName of neededTextureNames) {
      const x = index % texturesPerRow;
      const y = Math.floor(index / texturesPerRow);

      const u = biomesPngTexturePrefix + textureName + '.png';
      const img = await loadImage(u);
      console.log('load u', u, textureName, img.width, img.height);

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          ctx.drawImage(
            img,
            x * textureTileSize + halfTextureTileSize * dx,
            y * textureTileSize + halfTextureTileSize * dy,
            halfTextureTileSize,
            halfTextureTileSize
          );
        }
      }
      atlasTextures.push({
        name: textureName,
        uv: [
          x * textureTileSize / size,
          y * textureTileSize / size,
          (x + 1) * textureTileSize / size,
          (y + 1) * textureTileSize / size,
        ],
      });
    
      index++;
    }

    const canvasBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(resolve, 'image/png');
    });
    downloadFile(canvasBlob, `${mapName}.png`);

    document.body.removeChild(canvas);
  }

  // const atlasJson = {
  //   textures: atlasTextures,
  // };
  // const atlasJsonString = JSON.stringify(atlasJson, null, 2);
  // const atlasJsonBlob = new Blob([atlasJsonString], {type: 'application/json'});
  // downloadFile(atlasJsonBlob, `megatexture-atlas.json`);
};
// window.bakeBiomesAtlas = bakeBiomesAtlas;

const {BatchedMesh} = useInstancing();
class TerrainMesh extends BatchedMesh {
  constructor({
    physics,
    // biomeDataTexture,
    biomeUvDataTexture,
    atlasTextures,
  }) {
    const allocator = new dcWorkerManager.constructor.GeometryAllocator([
      {
        name: 'position',
        Type: Float32Array,
        itemSize: 3,
      },
      {
        name: 'normal',
        Type: Float32Array,
        itemSize: 3,
      },
      {
        name: 'biomes',
        Type: Int32Array,
        itemSize: 4,
      },
      {
        name: 'biomesWeights',
        Type: Float32Array,
        itemSize: 4,
      },
    ], {
      bufferSize,
      boundingType: 'sphere',
    });
    const {geometry} = allocator;

    /* const earthTexture = textureLoader.load(
      baseUrl + 'assets/textures/EarthBaseColor1.png'
    );
    earthTexture.wrapS = earthTexture.wrapT = THREE.RepeatWrapping;
    earthTexture.encoding = THREE.sRGBEncoding;
    const earthNormal = textureLoader.load(
      baseUrl + 'assets/textures/EarthNormal1.png'
    );
    earthNormal.wrapS = earthNormal.wrapT = THREE.RepeatWrapping;

    const grassTexture = textureLoader.load(
      baseUrl + 'assets/textures/GrassBaseColor1.png'
    );
    grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
    const grassNormal = textureLoader.load(
      baseUrl + 'assets/textures/GrassNormal1.png'
    )
    grassNormal.wrapS = grassNormal.wrapT = THREE.RepeatWrapping */
    const material = new THREE.MeshStandardMaterial({
      map: new THREE.Texture(),
      normalMap: new THREE.Texture(),
      emissiveMap: new THREE.Texture(),
      // normalScale: new THREE.Vector2(50, 50),
      // normalMapType: THREE.ObjectSpaceNormalMap,
      bumpMap: new THREE.Texture(),
      // bumpScale: 1,
      roughnessMap: new THREE.Texture(),
      aoMap: new THREE.Texture(),
      transparent: true,
      onBeforeCompile: (shader) => {
        // console.log('on before compile', shader.fragmentShader);

        shader.uniforms.biomeUvDataTexture = {
          value: biomeUvDataTexture,
          needsUpdate: true,
        };
        for (const mapName of mapNames) {
          shader.uniforms[mapName] = {
            value: atlasTextures[mapName],
            needsUpdate: true,
          };
        }
        
        // vertex shader

        shader.vertexShader = shader.vertexShader.replace(`#include <uv_pars_vertex>`, `\
#ifdef USE_UV
	#ifdef UVS_VERTEX_ONLY
		vec2 vUv;
	#else
		varying vec2 vUv;
	#endif
	uniform mat3 uvTransform;
#endif

attribute ivec4 biomes;
attribute vec4 biomesWeights;
// uniform sampler2D map;
flat varying ivec4 vBiomes;
varying vec4 vBiomesWeights;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
        `);
        shader.vertexShader = shader.vertexShader.replace(`#include <worldpos_vertex>`, `\
// #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION )
  vec4 worldPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    worldPosition = instanceMatrix * worldPosition;
  #endif
  worldPosition = modelMatrix * worldPosition;
// #endif

vWorldPosition = worldPosition.xyz;
vWorldNormal = (modelMatrix * vec4(normal, 0.0)).xyz;
vBiomes = biomes;
vBiomesWeights = biomesWeights;
        `);

        // fragment shader

        shader.fragmentShader = shader.fragmentShader.replace(`#include <map_pars_fragment>`, `\
#ifdef USE_MAP
  // uniform sampler2D map;
#endif

uniform sampler2D Base_Color;
uniform sampler2D Emissive;
uniform sampler2D Normal;
uniform sampler2D Roughness;
uniform sampler2D Ambient_Occlusion;
uniform sampler2D Height;
uniform sampler2D biomeUvDataTexture;
flat varying ivec4 vBiomes;
varying vec4 vBiomesWeights;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

vec4 fourTapSample(
  sampler2D atlas,
  vec2 tileUV,
  vec2 tileOffset,
  vec2 tileSize
) {
  //Initialize accumulators
  vec4 color = vec4(0.0, 0.0, 0.0, 0.0);
  float totalWeight = 0.0;

  for (int dx=0; dx<2; ++dx) {
    for (int dy=0; dy<2; ++dy) {
      //Compute coordinate in 2x2 tile patch
      vec2 tileCoord = 2.0 * fract(0.5 * (tileUV + vec2(dx,dy)));

      //Weight sample based on distance to center
      float w = pow(1.0 - max(abs(tileCoord.x-1.0), abs(tileCoord.y-1.0)), 16.0);

      //Compute atlas coord
      vec2 atlasUV = tileOffset + tileSize * tileCoord;

      //Sample and accumulate
      color += w * texture2D(atlas, atlasUV);
      totalWeight += w;
    }
  }

  return color / totalWeight;
}
vec4 triplanarMap(sampler2D Base_Color, vec3 position, vec3 normal) {
  // Triplanar mapping
  vec2 tx = position.yz;
  vec2 ty = position.zx;
  vec2 tz = position.xy;

  vec2 tileOffset = texture2D(biomeUvDataTexture, vec2((float(vBiomes.x) + 0.5) / 256., 0.5)).rg;
  const vec2 tileSize = vec2(1. / ${texturesPerRow.toFixed(8)}) * 0.5;

  vec3 bf = normalize(abs(normal));
  bf /= dot(bf, vec3(1.));

  vec4 cx = fourTapSample(Base_Color, tx, tileOffset, tileSize) * bf.x;
  vec4 cy = fourTapSample(Base_Color, ty, tileOffset, tileSize) * bf.y;
  vec4 cz = fourTapSample(Base_Color, tz, tileOffset, tileSize) * bf.z;
  
  vec4 color = cx + cy + cz;
  return color;
}
vec4 triplanarMapDx(sampler2D Base_Color, vec3 position, vec3 normal) {
  // Triplanar mapping
  vec2 tx = position.yz;
  vec2 ty = position.zx;
  vec2 tz = position.xy;

  vec2 txDx = dFdx(tx);
  vec2 tyDx = dFdx(ty);
  vec2 tzDx = dFdx(tz);

  vec2 tileOffset = texture2D(biomeUvDataTexture, vec2((float(vBiomes.x) + 0.5) / 256., 0.5)).rg;
  const vec2 tileSize = vec2(1. / ${texturesPerRow.toFixed(8)}) * 0.5;

  vec3 bf = normalize(abs(normal));
  bf /= dot(bf, vec3(1.));

  vec4 cx = fourTapSample(Base_Color, tx + txDx, tileOffset, tileSize) * bf.x;
  vec4 cy = fourTapSample(Base_Color, ty + tyDx, tileOffset, tileSize) * bf.y;
  vec4 cz = fourTapSample(Base_Color, tz + tzDx, tileOffset, tileSize) * bf.z;
  
  vec4 color = cx + cy + cz;
  return color;
}
vec4 triplanarMapDy(sampler2D Base_Color, vec3 position, vec3 normal) {
  // Triplanar mapping
  vec2 tx = position.yz;
  vec2 ty = position.zx;
  vec2 tz = position.xy;

  vec2 txDy = dFdy(tx);
  vec2 tyDy = dFdy(ty);
  vec2 tzDy = dFdy(tz);

  vec2 tileOffset = texture2D(biomeUvDataTexture, vec2((float(vBiomes.x) + 0.5) / 256., 0.5)).rg;
  const vec2 tileSize = vec2(1. / ${texturesPerRow.toFixed(8)}) * 0.5;

  vec3 bf = normalize(abs(normal));
  bf /= dot(bf, vec3(1.));

  vec4 cx = fourTapSample(Base_Color, tx + txDy, tileOffset, tileSize) * bf.x;
  vec4 cy = fourTapSample(Base_Color, ty + tyDy, tileOffset, tileSize) * bf.y;
  vec4 cz = fourTapSample(Base_Color, tz + tzDy, tileOffset, tileSize) * bf.z;
  
  vec4 color = cx + cy + cz;
  return color;
}
vec4 triplanarNormal(sampler2D Normal, vec3 position, vec3 normal) {
  // Tangent Reconstruction
  // Triplanar uvs
  vec2 uvX = position.zy;
  vec2 uvY = position.xz;
  vec2 uvZ = position.xy;

  vec2 tileOffset = texture2D(biomeUvDataTexture, vec2((float(vBiomes.x) + 0.5) / 256., 0.5)).rg;
  const vec2 tileSize = vec2(1. / ${texturesPerRow.toFixed(8)}) * 0.5;
  
  vec3 bf = normalize(abs(normal));
  bf /= dot(bf, vec3(1.));
  
  vec4 cx = fourTapSample(Normal, uvX, tileOffset, tileSize);
  vec4 cy = fourTapSample(Normal, uvY, tileOffset, tileSize);
  vec4 cz = fourTapSample(Normal, uvZ, tileOffset, tileSize);

  cx = cx * 2. - 1.;
  cy = cy * 2. - 1.;
  cz = cz * 2. - 1.;

  cx *= bf.x;
  cy *= bf.y;
  cz *= bf.z;

  cx = (cx + 1.) / 2.;
  cy = (cy + 1.) / 2.;
  cz = (cz + 1.) / 2.;

  vec4 color = cx + cy + cz;
  return color;

  /* // Get the sign (-1 or 1) of the surface normal
  vec3 axis = sign(vNormal);

  // Construct tangent to world matrices for each axis
  vec3 tangentX = normalize(cross(vNormal, vec3(0.0, axis.x, 0.0)));
  vec3 bitangentX = normalize(cross(tangentX, vNormal)) * axis.x;
  mat3 tbnX = mat3(tangentX, bitangentX, vNormal);
  vec3 tangentY = normalize(cross(vNormal, vec3(0.0, 0.0, axis.y)));
  vec3 bitangentY = normalize(cross(tangentY, vNormal)) * axis.y;
  mat3 tbnY = mat3(tangentY, bitangentY, vNormal);
  vec3 tangentZ = normalize(cross(vNormal, vec3(0.0, -axis.z, 0.0)));
  vec3 bitangentZ = normalize(-cross(tangentZ, vNormal)) * axis.z;
  mat3 tbnZ = mat3(tangentZ, bitangentZ, vNormal);
  // Apply tangent to world matrix and triblend
  // Using clamp() because the cross products may be NANs
  vec3 worldNormal = normalize(
      clamp(tbnX * tx, -1.0, 1.0) * bf.x +
      clamp(tbnY * ty, -1.0, 1.0) * bf.y +
      clamp(tbnZ * tz, -1.0, 1.0) * bf.z
  );
  return vec4(worldNormal, 0.0); */
}
        `);
        shader.fragmentShader = shader.fragmentShader.replace(`#include <bumpmap_pars_fragment>`, `\
#ifdef USE_BUMPMAP
	// uniform sampler2D bumpMap;
	uniform float bumpScale;
	// Bump Mapping Unparametrized Surfaces on the GPU by Morten S. Mikkelsen
	// https://mmikk.github.io/papers3d/mm_sfgrad_bump.pdf
	// Evaluate the derivative of the height w.r.t. screen-space using forward differencing (listing 2)
	vec2 dHdxy_fwd() {
		// vec2 dSTdx = dFdx( vUv );
		// vec2 dSTdy = dFdy( vUv );

		float Hll = bumpScale * triplanarMap( Normal, vWorldPosition, vWorldNormal ).x;
		float dBx = bumpScale * triplanarMapDx( Normal, vWorldPosition, vWorldNormal ).x - Hll;
		float dBy = bumpScale * triplanarMapDy( Normal, vWorldPosition, vWorldNormal ).x - Hll;
    return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		// Workaround for Adreno 3XX dFd*( vec3 ) bug. See #9988
		vec3 vSigmaX = vec3( dFdx( surf_pos.x ), dFdx( surf_pos.y ), dFdx( surf_pos.z ) );
		vec3 vSigmaY = vec3( dFdy( surf_pos.x ), dFdy( surf_pos.y ), dFdy( surf_pos.z ) );
		vec3 vN = surf_norm;		// normalized
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif
        `);
        shader.fragmentShader = shader.fragmentShader.replace(`#include <roughnessmap_fragment>`, `\
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = triplanarMap( Roughness, vWorldPosition, vWorldNormal );
	// reads channel G, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
	roughnessFactor *= texelRoughness.g;
#endif
        `);
        shader.fragmentShader = shader.fragmentShader.replace(`#include <normal_fragment_maps>`, `\
#ifdef OBJECTSPACE_NORMALMAP
	normal = triplanarNormal(Normal, vWorldPosition, vWorldNormal).xyz /*texture2D( normalMap, vUv ).xyz*/ * 2.0 - 1.0; // overrides both flatShading and attribute normals
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal ) * 10.;
#elif defined( TANGENTSPACE_NORMALMAP )
	vec3 mapN = triplanarNormal(Normal, vWorldPosition, vWorldNormal).xyz /*texture2D( normalMap, vUv ).xyz*/ * 2.0 - 1.0;
	mapN.xy *= normalScale;
	#ifdef USE_TANGENT
		normal = normalize( vTBN * mapN );
  #else
		normal = perturbNormal2Arb( - vViewPosition, normal, mapN, faceDirection );
	#endif
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif
        `);
        shader.fragmentShader = shader.fragmentShader.replace(`#include <map_fragment>`, `\
#ifdef USE_MAP
  vec4 sampledDiffuseColor = triplanarMap(Base_Color, vWorldPosition, vWorldNormal);
  sampledDiffuseColor.a = 1.;
  #ifdef DECODE_VIDEO_TEXTURE
    // inline sRGB decode (TODO: Remove this code when https://crbug.com/1256340 is solved)
    sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
  #endif
  diffuseColor *= sampledDiffuseColor;
#endif
        `);
        shader.fragmentShader = shader.fragmentShader.replace(`#include <aomap_fragment>`, `\
#ifdef USE_AOMAP
  // reads channel R, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
  float ambientOcclusion = ( triplanarMap( Ambient_Occlusion, vWorldPosition, vWorldNormal ).r /* * - 1.0 */ ) * aoMapIntensity /* + 1.0 */;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometry.normal, geometry.viewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
#endif
        `);
        return shader;
      },
    });
    super(geometry, material, allocator);
    this.frustumCulled = false;

    this.physics = physics;
    this.allocator = allocator;
    this.physicsObjects = [];

    // window.terrainMesh = this;
  }
  async addChunk(chunk, {
    signal,
  }) {
    const meshData = await dcWorkerManager.generateChunk(chunk, chunk.lodArray);
    // console.log('mesh data', meshData);
    signal.throwIfAborted();
    if (meshData) { // non-empty chunk
      const _mapOffsettedIndices = (srcIndices, dstIndices, dstOffset, positionOffset) => {
        const positionIndex = positionOffset / 3;
        for (let i = 0; i < srcIndices.length; i++) {
          dstIndices[dstOffset + i] = srcIndices[i] + positionIndex;
        }
      };
      const _renderMeshDataToGeometry = (meshData, geometry, geometryBinding) => {
        let positionOffset = geometryBinding.getAttributeOffset('position');
        let normalOffset = geometryBinding.getAttributeOffset('normal');
        let biomesOffset = geometryBinding.getAttributeOffset('biomes');
        let biomesWeightsOffset = geometryBinding.getAttributeOffset('biomesWeights');
        let indexOffset = geometryBinding.getIndexOffset();

        _mapOffsettedIndices(meshData.indices, geometry.index.array, indexOffset, positionOffset);

        geometry.attributes.position.update(positionOffset, meshData.positions.length, meshData.positions, 0);
        geometry.attributes.normal.update(normalOffset, meshData.normals.length, meshData.normals, 0);
        geometry.attributes.biomes.update(biomesOffset, meshData.biomes.length, meshData.biomes, 0);
        geometry.attributes.biomesWeights.update(biomesWeightsOffset, meshData.biomesWeights.length, meshData.biomesWeights, 0);
        geometry.index.update(indexOffset, meshData.indices.length);
      };
      /* const _updateRenderList = () => {
        this.allocator.geometry.groups = this.allocator.indexFreeList.getGeometryGroups(); // XXX memory for this can be optimized
      }; */
      const _handleMesh = () => {
        localSphere.center.set((chunk.x + 0.5) * chunkWorldSize, (chunk.y + 0.5) * chunkWorldSize, (chunk.z + 0.5) * chunkWorldSize)
          .applyMatrix4(this.matrixWorld);
        localSphere.radius = chunkRadius;
        const geometryBinding = this.allocator.alloc(
          meshData.positions.length,
          meshData.indices.length,
          localSphere
        );
        _renderMeshDataToGeometry(meshData, this.allocator.geometry, geometryBinding);
        // _updateRenderList();

        signal.addEventListener('abort', e => {
          this.allocator.free(geometryBinding);
          // _updateRenderList();
        });
      };
      _handleMesh();

      const _handlePhysics = async () => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
        const physycsMesh = new THREE.Mesh(geometry, fakeMaterial);
    
        // console.log('cook 1', mesh);
        const geometryBuffer = await this.physics.cookGeometryAsync(physycsMesh, {
          signal,
        });
        // console.log('cook 2', mesh);

        this.matrixWorld.decompose(localVector, localQuaternion, localVector2);
        const physicsObject = this.physics.addCookedGeometry(geometryBuffer, localVector, localQuaternion, localVector2);
        this.physicsObjects.push(physicsObject);
        
        // console.log('cook 3', mesh);

        signal.addEventListener('abort', e => {
          this.physics.removeGeometry(physicsObject);
          this.physicsObjects.splice(this.physicsObjects.indexOf(physicsObject), 1);
        });
      };
      await _handlePhysics();
    }
  }
}

class TerrainChunkGenerator {
  constructor(parent, {
    physics,
    // biomeDataTexture,
    biomeUvDataTexture,
    atlasTextures,
  } = {}) {
    // parameters
    this.parent = parent;
    this.physics = physics;
    // this.biomeDataTexture = biomeDataTexture;
    this.biomeUvDataTexture = biomeUvDataTexture;
    this.atlasTextures = atlasTextures;

    // mesh
    this.object = new THREE.Group();
    this.object.name = 'terrain-chunk-generator';

    this.terrainMesh = new TerrainMesh({
      physics: this.physics,
      // biomeDataTexture: this.biomeDataTexture,
      biomeUvDataTexture: this.biomeUvDataTexture,
      atlasTextures: this.atlasTextures,
    });
    this.object.add(this.terrainMesh);
  }

  getMeshes() {
    return this.object.children;
  }
  getPhysicsObjects() {
    // console.log('get physics object', this.terrainMesh.physicsObjects);
    return this.terrainMesh.physicsObjects;
  }
  generateChunk(chunk) {
    const abortController = new AbortController();
    const {signal} = abortController;

    this.terrainMesh.addChunk(chunk, {
      signal,
    }).catch(err => {
      if (err !== abortError) {
        console.warn(err);
      }
    });

    chunk.binding = {
      abortController,
      // signal,
    }
  }

  disposeChunk(chunk) {
    const binding = chunk.binding;
    if (binding) {
      const {abortController} = binding;
      abortController.abort(abortError);

      chunk.binding = null;
    }
  }

  /* getMeshAtWorldPosition(p) {
    return null; // XXX will be done with intersection
    localVector.copy(p).divideScalar(chunkWorldSize);
    const mesh =
      this.object.children.find(
        (m) => !!m.chunk && m.chunk.equals(localVector)
      ) || null;
    return mesh;
  } */

  hit(e) {
    const {hitPosition} = e;
    // console.log('hit 1', hitPosition.toArray().join(','));
    const result = dcWorkerManager.eraseSphereDamage(hitPosition, 3);
    // console.log('hit 2', hitPosition.toArray().join(','), result);
    /* const oldMeshes = neededChunkMins.map((v) => {
      return this.getMeshAtWorldPosition(v);
    });
    const oldChunks = oldMeshes.filter(mesh => mesh !== null).map(mesh => mesh.chunk);
    for (const oldChunk of oldChunks) {
      this.disposeChunk(oldChunk);
    }

    setTimeout(async () => {
      await Promise.all(neededChunkMins.map(async minVector => {
        const chunkPosition = localVector.copy(minVector).divideScalar(chunkWorldSize).clone();
        const chunk = await this.generateChunk(chunkPosition);
        return chunk;
      }));
      // console.log('got hit result', result, chunks, this.object.children.map(m => m.chunk.toArray().join(',')));
    }, 1000); */
  }

  update(timestamp, timeDiff) {
    for (const mesh of this.getMeshes()) {
      mesh.update(timestamp, timeDiff);
    }
  }

  destroy() {
    // nothing; the owning lod tracker disposes of our contents
  }
}

window.addAoMesh = async () => {
  const dcWorkerManager = useDcWorkerManager();
  const pos = new THREE.Vector3(0, 0, 0);
  const size = chunkWorldSize * 2;
  const lod = 1;
  const aos = await dcWorkerManager.getAoFieldRange(
    pos.x, pos.y, pos.z,
    size, size, size,
    lod,
  );
  console.log('got aos', aos);

  const aoTex = new THREE.DataTexture3D(aos, size, size, size);

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const geometry = new THREE.InstancedBufferGeometry().copy(boxGeometry);
  const material = new WebaverseShaderMaterial({
    uniforms: {
      uAoTex: {
        value: aoTex,
        needsUpdate: true,
      }
    },
    vertexShader: `\
      varying vec3 vUv;

      void main() {
        vUv = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `\
      precision highp float;
      precision highp int;

      #define PI 3.1415926535897932384626433832795

      uniform sampler3D uAoTex;
      varying vec2 vUv;

      void main() {
        vec4 sampleColor = texture3D(uAoTex, vUv);        
        gl_FragColor = vec4(sampleColor, 0., 0., 1.);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geometry, material);
  mesh.frustumCulled = false;
  
  const scene = useScene();
  scene.add(mesh);
};

export default (e) => {
  const app = useApp();
  const physics = usePhysics();
  const {LodChunkTracker} = useLodder();

  app.name = 'dual-contouring-terrain';

  let live = true;
  let generator = null;
  let tracker = null;
  e.waitUntil((async () => {
    /* const biomeDataTexture = (() => {
      const data = new Uint8Array(256 * 4);
      for (let i = 0; i < biomeSpecs.length; i++) {
        const biomeSpec = biomeSpecs[i];
        const [name, colorHex, textureName] = biomeSpec;
        localColor.setHex(colorHex);
        data[i * 4] = localColor.r * 255;
        data[i * 4 + 1] = localColor.g * 255;
        data[i * 4 + 2] = localColor.b * 255;
        data[i * 4 + 3] = 255;
      }
      const texture = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.needsUpdate = true;
      return texture;
    })(); */
    const biomeUvDataTexture = (() => {
      const data = new Uint8Array(256 * 4);
      for (let i = 0; i < biomeSpecs.length; i++) {
        const biomeSpec = biomeSpecs[i];
        const [name, colorHex, textureName] = biomeSpec;
        
        const biomeAtlasIndex = neededTexturePrefixes.indexOf(textureName);
        if (biomeAtlasIndex === -1) {
          throw new Error('no such biome: ' + textureName);
        }
        
        const x = biomeAtlasIndex % texturesPerRow;
        const y = Math.floor(biomeAtlasIndex / texturesPerRow);
        
        data[i * 4] = x / texturesPerRow * 255;
        data[i * 4 + 1] = y / texturesPerRow * 255;
        data[i * 4 + 2] = 0;
        data[i * 4 + 3] = 255;
      }
      // console.log('got uv data texture', data);
      const texture = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.needsUpdate = true;
      return texture;
    })();
    // window.biomeUvDataTexture = biomeUvDataTexture;

    const {ktx2Loader} = useLoaders();
    const atlasTexturesArray = await Promise.all(mapNames.map(mapName => new Promise((accept, reject) => {
      ktx2Loader.load(`${biomesKtx2TexturePrefix}build/8k/${mapName}.ktx2`, accept, function onprogress(e) {}, reject);
    })));
    // window.atlasTexturesArray = atlasTexturesArray;
    if (!live) return;
    
    const atlasTextures = {};
    for (let i = 0; i < mapNames.length; i++) {
      // atlasTexturesArray[i].needsUpdate = true;
      // atlasTexturesArray[i].wrapS = THREE.RepeatWrapping;
      // atlasTexturesArray[i].wrapT = THREE.RepeatWrapping;
      const compressedTexture = atlasTexturesArray[i];
      // compressedTexture.encoding = (mapNames === 'Base_Color' || mapNames === 'Emissive') ? THREE.sRGBEncoding : THREE.LinearEncoding;
      compressedTexture.anisotropy = 16;
      // compressedTexture.premultiplyAlpha = true;
      atlasTextures[mapNames[i]] = compressedTexture;
    }

    generator = new TerrainChunkGenerator(this, {
      physics,
      // biomeDataTexture,
      biomeUvDataTexture,
      atlasTextures,
    });
    tracker = new LodChunkTracker(generator, {
      chunkWorldSize,
      numLods,
      chunkHeight: chunkWorldSize,
    });

    app.add(generator.object);
    generator.object.updateMatrixWorld();
  })());

  app.getPhysicsObjects = () => generator ? generator.getPhysicsObjects() : [];

  // console.log('got hit tracker', app.hitTracker);
  app.addEventListener('hit', e => {
    generator && generator.hit(e);
  });

  useFrame(() => {
    if (tracker) {
      const localPlayer = useLocalPlayer();
      localMatrix.copy(localPlayer.matrixWorld)
        .premultiply(
          localMatrix2.copy(app.matrixWorld).invert()
        )
        .decompose(localVector, localQuaternion, localVector2)
      tracker.update(localVector);
    }
  });

  useCleanup(() => {
    live = false;
    tracker && tracker.destroy();
  });

  return app
}
