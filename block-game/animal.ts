import { MeshBuilder, TransformNode, Vector4 } from "@babylonjs/core";
import { material } from "./assets.ts";

const pigModel = {
    body: {
        height: 8,
        width: 10,
        depth: 16,
        front: { left: 36, top: 8 },
        back: { left: 46, top: 8 },
    }
};

const flipUV = (v: Vector4) => new Vector4(v.y, v.z, v.w, v.x);

export function createPig() {
    const root = new TransformNode("pig");

    const pig = material("entity/pig/temperate_pig");

    const body = MeshBuilder.CreateBox("pig_body", {
        width: pigModel.body.width,
        height: pigModel.body.height,
        depth: pigModel.body.depth,
        faceUV: [
            flipUV(new Vector4(pigModel.body.front.top, pigModel.body.front.left, pigModel.body.front.top + pigModel.body.height, pigModel.body.front.left + pigModel.body.width).scaleInPlace(1 / 64)),
            flipUV(new Vector4(pigModel.body.back.top, pigModel.body.back.left, pigModel.body.back.top + pigModel.body.height, pigModel.body.back.left + pigModel.body.width).scaleInPlace(1 / 64)),
            new Vector4(0, 0, 1, 1),
            new Vector4(0, 0, 1, 1)
        ],
        wrap: true
    });
    body.parent = root;
    body.material = pig;

    // apply UVs

    return root;
}
