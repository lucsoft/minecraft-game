import { assert, assertArrayIncludes } from "jsr:@std/assert@1.0.6";
import { AtlasMetaData, FaceName, getAtlasMetaData, getMinecraftMaterialFromName, getMinecraftModelInfo, MinecraftBlockstate, minecraftBlockstates, MinecraftModel, normalizeName } from "./assets.ts";
import * as BABYLON from "https://esm.sh/@babylonjs/core";


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

const expectedFaces = ['north', 'south', 'west',  'east', 'up', 'down'];

function getFaceVertices(element: Required<MinecraftModel>[ "elements" ][ number ], face: string) {
    const [x1,y1,z1] = element.from;
    const [x2,y2,z2] = element.to;

    switch(face) {
        case "up":    return [new BABYLON.Vector3(x1,y2,z1), new BABYLON.Vector3(x2,y2,z1), new BABYLON.Vector3(x2,y2,z2), new BABYLON.Vector3(x1,y2,z2)];
        case "down":  return [new BABYLON.Vector3(x1,y1,z1), new BABYLON.Vector3(x1,y1,z2), new BABYLON.Vector3(x2,y1,z2), new BABYLON.Vector3(x2,y1,z1)];
        case "north": return [new BABYLON.Vector3(x1,y1,z1), new BABYLON.Vector3(x2,y1,z1), new BABYLON.Vector3(x2,y2,z1), new BABYLON.Vector3(x1,y2,z1)]; // flipped
        case "south": return [new BABYLON.Vector3(x2,y1,z2), new BABYLON.Vector3(x1,y1,z2), new BABYLON.Vector3(x1,y2,z2), new BABYLON.Vector3(x2,y2,z2)]; // flipped
        case "west":  return [new BABYLON.Vector3(x1,y1,z2), new BABYLON.Vector3(x1,y1,z1), new BABYLON.Vector3(x1,y2,z1), new BABYLON.Vector3(x1,y2,z2)]; // flipped
        case "east":  return [new BABYLON.Vector3(x2,y1,z1), new BABYLON.Vector3(x2,y1,z2), new BABYLON.Vector3(x2,y2,z2), new BABYLON.Vector3(x2,y2,z1)]; // flipped
        default: throw new Error("Unknown face: "+face);
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

function computeFaceUVAtlasMapped(face: string, faceUV: number[], atlasUV: BABYLON.Vector4, rotation = 0, texWidth = 16, texHeight = 16): number[] {
    // Normalize face UV
    const u0 = faceUV[0] / texWidth;
    const v0 = faceUV[1] / texHeight;
    const u1 = faceUV[2] / texWidth;
    const v1 = faceUV[3] / texHeight;

    // Map into atlas
    const au0 = BABYLON.Scalar.Lerp(atlasUV.x, atlasUV.z, u0);
    const av0 = BABYLON.Scalar.Lerp(atlasUV.y, atlasUV.w, v0);
    const au1 = BABYLON.Scalar.Lerp(atlasUV.x, atlasUV.z, u1);
    const av1 = BABYLON.Scalar.Lerp(atlasUV.y, atlasUV.w, v1);

    let uvs: number[];
    switch(face) {
        case "up":    uvs = [au0,av0, au1,av0, au1,av1, au0,av1]; break;
        case "down":  uvs = [au0,av0, au0,av1, au1,av1, au1,av0]; break;
        case "north": uvs = [au1,av0, au0,av0, au0,av1, au1,av1]; break;
        case "south": uvs = [au0,av0, au1,av0, au1,av1, au0,av1]; break;
        case "west":  uvs = [au1,av0, au0,av0, au0,av1, au1,av1]; break;
        case "east":  uvs = [au0,av0, au1,av0, au1,av1, au0,av1]; break;
        default: throw new Error("Unknown face: "+face);
    }

    const rotationSteps = (((["up"] as FaceName[]).includes(face) ? rotation + 180 : rotation) / 90) % 4;
    return rotateFaceUVs(uvs, rotationSteps * 90);
}

function rotateFaceUVs(uvs: number[], rotation: number): number[] {
    if (!rotation) return uvs;

    const steps = (rotation / 90) % 4;
    if (steps === 0) return uvs;

    const quad = [
        [uvs[0], uvs[1]], // v0
        [uvs[2], uvs[3]], // v1
        [uvs[4], uvs[5]], // v2
        [uvs[6], uvs[7]]  // v3
    ];

    const rotatedQuad = quad.map((_, i) => quad[(i - steps + 4) % 4]);
    return rotatedQuad.flat();
}

export function bakeModel(externalName: string) {
    const realName = normalizeName(externalName);
    const model = getMinecraftModelInfo(realName);
    assert(model != null, `Model not found: ${realName}`);

    if (!model.elements || !model.textures)
        return new BABYLON.Mesh("emptyModel");

    const textureList = Object.entries(model.textures);
    const realTextureMappings: Record<string, AtlasMetaData> = Object.fromEntries(textureList.filter(([ key, value ]) => !value.startsWith("#")).map(([ key, value ]) => [ key, getAtlasMetaData(value) ]))
    const resolvedTextures: Record<string, AtlasMetaData> = Object.fromEntries(textureList.map(([ key, value ]) => [ key, value.startsWith("#") ? realTextureMappings[ value.slice(1) ] : getAtlasMetaData(value) ]));

    const meshes: BABYLON.Mesh[] = [];

    for (const element of model.elements) {
        const positions: BABYLON.FloatArray = [];
        const indices = [];
        const uvs = [];
        let indexOffset = 0;
        assertArrayIncludes(expectedFaces, Object.keys(element.faces), 'Element is missing some faces');
        for (const faceName of expectedFaces) {
            const face = element.faces[ faceName as keyof typeof element.faces ];
            if (!face) continue;
            const atlasUV = resolvedTextures[ face.texture.slice(1) ].atlasUV;
            assert(atlasUV != null, `Texture not found for face ${faceName} in element`);
            assert(face != null, `Element is missing face: ${faceName}`);
            let vertices = getFaceVertices(element, faceName);
            if (element.rotation)
                vertices = applyRotation(vertices, element.rotation);

            // Push positions
            vertices.forEach(v => positions.push(v.x, v.y, v.z));

            // Two triangles per quad
            indices.push(indexOffset,indexOffset+1,indexOffset+2);
            indices.push(indexOffset,indexOffset+2,indexOffset+3);
            indexOffset += 4;

            const faceUV = element.faces[ faceName as keyof typeof element.faces ].uv || [ 0, 0, 16, 16 ];
            const faceUVs = computeFaceUVAtlasMapped(faceName, faceUV, atlasUV, face.rotation);

            uvs.push(...faceUVs);
        }


        const customMesh = new BABYLON.Mesh("bakedElement");


        const vertexData = new BABYLON.VertexData();
        vertexData.positions = positions;
        vertexData.indices = indices;
        vertexData.uvs = uvs;

        vertexData.applyToMesh(customMesh);
        customMesh.material = getMinecraftMaterialFromName(realName);
        meshes.push(customMesh);
    }

    const parentMesh = BABYLON.Mesh.MergeMeshes(meshes, undefined, true, undefined, undefined, true)!;

    return parentMesh;
}