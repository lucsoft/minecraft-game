import { playDeliver, playMerge, playRound, playShoot, unlockAudio } from "./audio.ts";
import { beginDrag, createGame, moveDrag, releaseDrag, resetGame, updateGame } from "./game.ts";
import { createHud } from "./hud.ts";
import { createStage } from "./scene.ts";

document.head.innerHTML += `<meta name="color-scheme" content="dark">`;

const canvas = document.createElement("canvas");
document.body.append(canvas);

const stage = await createStage(canvas);
const hud = createHud();
const state = createGame();

hud.onRestart(() => resetGame(state));
// the canvas can change size without a window resize event, e.g. a phone hiding its address bar
new ResizeObserver(() => stage.resize()).observe(canvas);

canvas.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    unlockAudio();
    canvas.setPointerCapture(event.pointerId);
    beginDrag(state, stage.boardFromPointer(event.clientX, event.clientY));
});

canvas.addEventListener("pointermove", (event) => {
    if (!state.drag || !event.isPrimary) return;
    moveDrag(state, stage.boardFromPointer(event.clientX, event.clientY));
});

// any way the gesture can end has to drop the held item, otherwise it sticks to the finger
for (const type of [ "pointerup", "pointercancel", "lostpointercapture" ]) {
    canvas.addEventListener(type, () => releaseDrag(state));
}

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

// @ts-expect-error debug handle, same as the block game
globalThis.mergeGame = { get state() { return state; }, stage };

let last = performance.now();
const heard = { shots: 0, merges: 0, deliveries: 0, round: 1 };

stage.engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    updateGame(state, dt);

    if (state.shots > heard.shots) playShoot();
    if (state.merges > heard.merges) playMerge(state.lastMergeTier);
    if (state.deliveries > heard.deliveries) playDeliver();
    if (state.round > heard.round) playRound();
    Object.assign(heard, { shots: state.shots, merges: state.merges, deliveries: state.deliveries, round: state.round });
    stage.sync(state, now / 1000);
    stage.scene.render();
    hud.update(state, stage.project);
});
