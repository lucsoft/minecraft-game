import * as BABYLON from "@babylonjs/core";
import { textureFileUrl } from "../asset-pipeline-url.ts";

export function pixelTexture(name: string, scene: BABYLON.Scene) {
    return new BABYLON.Texture(textureFileUrl(name), scene, false, true, BABYLON.Texture.NEAREST_NEAREST_MIPLINEAR);
}

/** tiling block material, one texture tile per `unitsPerTile` board units */
export function blockMaterial(name: string, scene: BABYLON.Scene, uTiles: number, vTiles: number) {
    const material = new BABYLON.StandardMaterial(`block:${name}`, scene);
    const texture = pixelTexture(name, scene);
    texture.uScale = uTiles;
    texture.vScale = vTiles;
    material.diffuseTexture = texture;
    material.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
    material.specularPower = 8;
    return material;
}

/** soft round patch that darkens the sand right under an item so it does not look glued on */
export function contactMaterial(scene: BABYLON.Scene) {
    const size = 128;
    const texture = new BABYLON.DynamicTexture("contact", { width: size, height: size }, scene, true);
    const context = texture.getContext() as unknown as CanvasRenderingContext2D;
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(0,0,0,0.85)");
    gradient.addColorStop(0.45, "rgba(0,0,0,0.4)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    texture.update();
    texture.hasAlpha = true;

    const material = new BABYLON.StandardMaterial("contact", scene);
    material.opacityTexture = texture;
    material.diffuseColor = new BABYLON.Color3(0, 0, 0);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
    material.emissiveColor = new BABYLON.Color3(0, 0, 0);
    material.disableLighting = true;
    material.alpha = 0.5;
    material.backFaceCulling = false;
    return material;
}

/** the item sprite as a flat black shape, used as its shadow on the sand */
export function silhouetteMaterial(name: string, scene: BABYLON.Scene) {
    const material = new BABYLON.StandardMaterial(`shade:${name}`, scene);
    const texture = pixelTexture(name, scene);
    texture.hasAlpha = true;
    material.opacityTexture = texture;
    material.diffuseColor = new BABYLON.Color3(0, 0, 0);
    material.specularColor = new BABYLON.Color3(0, 0, 0);
    material.emissiveColor = new BABYLON.Color3(0, 0, 0);
    material.disableLighting = true;
    material.alpha = 0.45;
    material.backFaceCulling = false;
    return material;
}

/** dropped-item look: the sprite on both wide faces, a flat colour on the edges */
export function itemMaterial(name: string, scene: BABYLON.Scene) {
    const material = new BABYLON.StandardMaterial(`item:${name}`, scene);
    const texture = pixelTexture(name, scene);
    texture.hasAlpha = true;
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
    material.backFaceCulling = false;
    material.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
    material.specularPower = 16;
    material.emissiveColor = new BABYLON.Color3(0.16, 0.16, 0.16);
    return material;
}
