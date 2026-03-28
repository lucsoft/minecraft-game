import * as BABYLON from "@babylonjs/core";
import { assert, assertArrayIncludes } from "@std/assert";
import { AtlasMetaData, FaceName, getAtlasMetaData, getMinecraftMaterialFromName, getMinecraftModelInfo, MinecraftBlockstate, minecraftBlockstates, MinecraftModel, normalizeName } from "./assets.ts";


export function getBlock(externalName: string) {
    const realName = normalizeName(externalName);
    return minecraftBlockstates.entries().find(([ key ]) => key === realName)?.[ 1 ];
}

export function getMinecraftModel(blockstate: MinecraftBlockstate) {
    if (!blockstate.variants) return null;
    const variantKey = Object.keys(blockstate.variants)[ 0 ];
    const variant = blockstate.variants[ variantKey ];
    const modelName = Array.isArray(variant) ? variant[ 0 ].model : variant.model;
    return modelName;
}

const expectedFaces = [ 'north', 'south', 'west', 'east', 'up', 'down' ];

const faceBrightness: Record<string, number> = {
    up: 1.0,
    down: 0.5,
    north: 0.8,
    south: 0.8,
    east: 0.6,
    west: 0.6,
};

function getFaceColors(face: string, vertexCount: number): number[] {
    const brightness = faceBrightness[ face ] ?? 1.0;
    const colors: number[] = [];
    for (let i = 0; i < vertexCount; i++)
        colors.push(brightness, brightness, brightness, 1.0);
    return colors;
}

function getFaceVertices(element: Required<MinecraftModel>[ "elements" ][ number ], face: string) {
    const [ x1, y1, z1 ] = element.from;
    const [ x2, y2, z2 ] = element.to;

    switch (face) {
        case "up": return [ new BABYLON.Vector3(x1, y2, z1), new BABYLON.Vector3(x2, y2, z1), new BABYLON.Vector3(x2, y2, z2), new BABYLON.Vector3(x1, y2, z2) ];
        case "down": return [ new BABYLON.Vector3(x1, y1, z1), new BABYLON.Vector3(x1, y1, z2), new BABYLON.Vector3(x2, y1, z2), new BABYLON.Vector3(x2, y1, z1) ];
        case "north": return [ new BABYLON.Vector3(x1, y1, z1), new BABYLON.Vector3(x2, y1, z1), new BABYLON.Vector3(x2, y2, z1), new BABYLON.Vector3(x1, y2, z1) ]; // flipped
        case "south": return [ new BABYLON.Vector3(x2, y1, z2), new BABYLON.Vector3(x1, y1, z2), new BABYLON.Vector3(x1, y2, z2), new BABYLON.Vector3(x2, y2, z2) ]; // flipped
        case "west": return [ new BABYLON.Vector3(x1, y1, z2), new BABYLON.Vector3(x1, y1, z1), new BABYLON.Vector3(x1, y2, z1), new BABYLON.Vector3(x1, y2, z2) ]; // flipped
        case "east": return [ new BABYLON.Vector3(x2, y1, z1), new BABYLON.Vector3(x2, y1, z2), new BABYLON.Vector3(x2, y2, z2), new BABYLON.Vector3(x2, y2, z1) ]; // flipped
        default: throw new Error("Unknown face: " + face);
    }
}


function applyRotation(vertices: BABYLON.Vector3[], rotation: Required<Required<MinecraftModel>[ "elements" ][ number ]>[ "rotation" ]) {
    if (!rotation) return vertices; // No rotation

    const axisMap = {
        x: new BABYLON.Vector3(1, 0, 0),
        y: new BABYLON.Vector3(0, 1, 0),
        z: new BABYLON.Vector3(0, 0, 1)
    };

    const origin = new BABYLON.Vector3(...rotation.origin);
    const axis = axisMap[ rotation.axis ];
    const angle = BABYLON.Angle.FromDegrees(rotation.angle).radians();

    const rotationMatrix = BABYLON.Matrix.RotationAxis(axis, angle);

    return vertices.map(v => {
        // Translate to origin
        const translated = v.subtract(origin);
        // Apply rotation
        const rotated = BABYLON.Vector3.TransformCoordinates(translated, rotationMatrix);
        // Translate back
        return rotated.add(origin);
    });
}

function getDefaultFaceUV(element: Required<MinecraftModel>[ "elements" ][ number ], face: string): number[] {
    const [ x1, y1, z1 ] = element.from;
    const [ x2, y2, z2 ] = element.to;
    switch (face) {
        case "north": return [ x1, 16 - y2, x2, 16 - y1 ];
        case "south": return [ 16 - x2, 16 - y2, 16 - x1, 16 - y1 ];
        case "west": return [ z1, 16 - y2, z2, 16 - y1 ];
        case "east": return [ 16 - z2, 16 - y2, 16 - z1, 16 - y1 ];
        case "up": return [ x1, z1, x2, z2 ];
        case "down": return [ x1, 16 - z2, x2, 16 - z1 ];
        default: throw new Error("Unknown face: " + face);
    }
}

const bottomLeftToTopLeft = (faceUV: number[]): number[] => {
    return [ 16 - faceUV[ 0 ], faceUV[ 3 ], 16 - faceUV[ 2 ], faceUV[ 1 ] ];
};

function computeFaceUVAtlasMapped(face: string, faceUV: number[], atlasUV: BABYLON.Vector4, rotation = 0): number[] {
    const faceUVVec = new BABYLON.Vector4(...bottomLeftToTopLeft(faceUV)).scale(0.0625);

    // Map into atlas
    const au0 = BABYLON.Scalar.Lerp(atlasUV.x, atlasUV.z, faceUVVec.x);
    const av0 = BABYLON.Scalar.Lerp(atlasUV.y, atlasUV.w, faceUVVec.y);
    const au1 = BABYLON.Scalar.Lerp(atlasUV.x, atlasUV.z, faceUVVec.z);
    const av1 = BABYLON.Scalar.Lerp(atlasUV.y, atlasUV.w, faceUVVec.w);

    let uvs: number[];
    switch (face) {
        case "up": uvs = [ au0, av0, au1, av0, au1, av1, au0, av1 ]; break;
        case "down": uvs = [ au0, av0, au0, av1, au1, av1, au1, av0 ]; break;
        case "north": uvs = [ au1, av0, au0, av0, au0, av1, au1, av1 ]; break;
        case "south": uvs = [ au0, av0, au1, av0, au1, av1, au0, av1 ]; break;
        case "west": uvs = [ au1, av0, au0, av0, au0, av1, au1, av1 ]; break;
        case "east": uvs = [ au0, av0, au1, av0, au1, av1, au0, av1 ]; break;
        default: throw new Error("Unknown face: " + face);
    }

    const rotationSteps = ((([ "up" ] as FaceName[]).includes(face) ? rotation + 180 : rotation) / 90) % 4;
    return rotateFaceUVs(uvs, rotationSteps * 90);
}

function rotateFaceUVs(uvs: number[], rotation: number): number[] {
    if (!rotation) return uvs;

    const steps = (rotation / 90) % 4;
    if (steps === 0) return uvs;

    const quad = [
        [ uvs[ 0 ], uvs[ 1 ] ], // v0
        [ uvs[ 2 ], uvs[ 3 ] ], // v1
        [ uvs[ 4 ], uvs[ 5 ] ], // v2
        [ uvs[ 6 ], uvs[ 7 ] ]  // v3
    ];

    const rotatedQuad = quad.map((_, i) => quad[ (i - steps + 4) % 4 ]);
    return rotatedQuad.flat();
}

export function resolveTextureVariables(texture: string, textures: Record<string, string>) {
    if (texture.startsWith("#")) {
        const key = texture.slice(1);
        const resolved = textures[ key ];
        assert(resolved != null, `Texture variable not found: ${key}`);
        return resolveTextureVariables(resolved, textures);
    }
    return texture;
}

export function createVertexDataFromModel(externalName: string, hideFaces?: ReadonlySet<string>): BABYLON.VertexData | null {
    const realName = normalizeName(externalName);
    const model = getMinecraftModelInfo(realName);
    assert(model != null, `Model not found: ${realName}`);

    if (!model.elements || !model.textures) return null;

    const textureList = Object.entries(model.textures).map(([ key, value ]) => [ key, resolveTextureVariables(value, model.textures ?? {}) ]);
    const resolvedTextures: Record<string, AtlasMetaData> = Object.fromEntries(textureList.map(([ key, value ]) => [ key, getAtlasMetaData(value) ]));

    const allPositions: number[] = [];
    const allIndices: number[] = [];
    const allUVs: number[] = [];
    const allColors: number[] = [];
    let indexOffset = 0;

    for (const element of model.elements) {
        assertArrayIncludes(expectedFaces, Object.keys(element.faces), 'Element is missing some faces');
        for (const faceName of expectedFaces) {
            const face = element.faces[ faceName as keyof typeof element.faces ];
            if (!face || hideFaces?.has(faceName)) continue;
            const atlasUV = resolvedTextures[ face.texture.replace("#", "") ]?.atlasUV;
            assert(atlasUV != null, `Texture not found for face ${faceName} in element ${realName}`);
            let vertices = getFaceVertices(element, faceName);
            if (element.rotation)
                vertices = applyRotation(vertices, element.rotation);

            vertices.forEach(v => allPositions.push(v.x, v.y, v.z));

            allIndices.push(indexOffset, indexOffset + 1, indexOffset + 2);
            allIndices.push(indexOffset, indexOffset + 2, indexOffset + 3);
            indexOffset += 4;

            const faceUV = face.uv || getDefaultFaceUV(element, faceName);
            allUVs.push(...computeFaceUVAtlasMapped(faceName, faceUV, atlasUV, face.rotation));
            allColors.push(...getFaceColors(faceName, 4));
        }
    }

    if (allPositions.length === 0) return null;

    const vertexData = new BABYLON.VertexData();
    vertexData.positions = allPositions;
    vertexData.indices = allIndices;
    vertexData.uvs = allUVs;
    vertexData.colors = allColors;
    return vertexData;
}

export function bakeModel(externalName: string, hideFaces?: ReadonlySet<string>): BABYLON.Mesh {
    const vertexData = createVertexDataFromModel(externalName, hideFaces);
    if (!vertexData) return new BABYLON.Mesh("emptyModel");
    const mesh = new BABYLON.Mesh("bakedModel");
    vertexData.applyToMesh(mesh);
    mesh.material = getMinecraftMaterialFromName(normalizeName(externalName));
    return mesh;
}

const transparentBlocks = new Set([
    "glass",
    "glass_pane",
    "tinted_glass",
    "ice",
    "frosted_ice",
    "barrier",
    "structure_void",
    "white_stained_glass",
    "orange_stained_glass",
    "magenta_stained_glass",
    "light_blue_stained_glass",
    "yellow_stained_glass",
    "lime_stained_glass",
    "pink_stained_glass",
    "gray_stained_glass",
    "light_gray_stained_glass",
    "cyan_stained_glass",
    "purple_stained_glass",
    "blue_stained_glass",
    "brown_stained_glass",
    "green_stained_glass",
    "red_stained_glass",
    "black_stained_glass",
    "white_stained_glass_pane",
    "orange_stained_glass_pane",
    "magenta_stained_glass_pane",
    "light_blue_stained_glass_pane",
    "yellow_stained_glass_pane",
    "lime_stained_glass_pane",
    "pink_stained_glass_pane",
    "gray_stained_glass_pane",
    "light_gray_stained_glass_pane",
    "cyan_stained_glass_pane",
    "purple_stained_glass_pane",
    "blue_stained_glass_pane",
    "brown_stained_glass_pane",
    "green_stained_glass_pane",
    "red_stained_glass_pane",
    "black_stained_glass_pane",
]);

export function isSolidBlock(name: string): boolean {
    const normalized = normalizeName(name);
    if (transparentBlocks.has(normalized.replace("minecraft:", ""))) return false;
    const model = getMinecraftModelInfo(normalized);
    if (!model?.elements || model.elements.length === 0) return false;
    return model.elements.every(el =>
        el.from[ 0 ] === 0 && el.from[ 1 ] === 0 && el.from[ 2 ] === 0 &&
        el.to[ 0 ] === 16 && el.to[ 1 ] === 16 && el.to[ 2 ] === 16
    );
}

export function isEmptyModel(name: string) {
    const model = getMinecraftModelInfo(normalizeName(name));
    if (!model || !model.elements) return true;
    if (model.elements.length === 0) return true;
    return false;
}