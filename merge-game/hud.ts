import { textureFileUrl } from "../asset-pipeline-url.ts";
import { FLIGHT_TIME, GameState } from "./game.ts";
import { boardTextures, itemTiers } from "./items.ts";

const style = `
.hud {
    position: fixed;
    inset: 0;
    pointer-events: none;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-weight: 700;
    color: #ffffff;
    text-shadow: 2px 2px 0 #000000;
    -webkit-user-select: none;
    user-select: none;
}

.hud img {
    image-rendering: pixelated;
    display: block;
}

.hud .panel {
    background: #16181ce6;
    border: 2px solid #000000;
    box-shadow: inset 2px 2px 0 #ffffff26, inset -2px -2px 0 #00000080;
    padding: 8px 12px;
}

.hud .top {
    position: absolute;
    inset: 10px 10px auto 10px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
}

.hud .coins {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 20px;
    line-height: 1;
}

.hud .coins img {
    width: 24px;
    height: 24px;
}

.hud .round {
    font-size: 12px;
    letter-spacing: 1px;
    opacity: .75;
    margin-top: 6px;
}

.hud .orders {
    display: flex;
    gap: 8px;
}

.hud .order {
    display: grid;
    justify-items: center;
    gap: 4px;
    min-width: 74px;
    padding: 6px 8px 8px;
}

.hud .order .label {
    font-size: 10px;
    letter-spacing: 1px;
    opacity: .7;
}

/* fixed height slot so differently sized icons keep the cards aligned */
.hud .order .slot {
    display: grid;
    place-items: center;
    height: 52px;
}

.hud .order .reward {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 15px;
}

.hud .order .reward img {
    width: 14px;
    height: 14px;
}

.hud .order.done {
    background: #17351ce6;
}

.hud .order.done img.item {
    opacity: .35;
}

.hud .order .check {
    position: absolute;
    font-size: 26px;
    color: #7bf07b;
    margin-top: 18px;
}

.hud .chain {
    position: absolute;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    max-width: calc(100% - 20px);
    overflow: hidden;
}

.hud .chain img {
    width: 26px;
    height: 26px;
    opacity: .22;
}

.hud .chain img.unlocked {
    opacity: 1;
}

.hud .hint {
    position: absolute;
    left: 50%;
    bottom: 78px;
    transform: translateX(-50%);
    font-size: 12px;
    letter-spacing: 1px;
    white-space: nowrap;
    animation: hudPulse 1.4s ease-in-out infinite;
}

@keyframes hudPulse {
    50% { opacity: .35; }
}

.hud .banner {
    position: absolute;
    left: 50%;
    top: 42%;
    transform: translate(-50%, -50%);
    font-size: 22px;
    letter-spacing: 2px;
    color: #ffe97f;
    white-space: nowrap;
}

.hud .float {
    position: absolute;
    font-size: 15px;
    transform: translate(-50%, -50%);
    white-space: nowrap;
}

/* delivered item flying up to its order card */
.hud .flight {
    position: absolute;
    transform-origin: center;
    filter: drop-shadow(0 3px 4px #00000088);
}

.hud .dialog {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 20px 28px;
    text-align: center;
}

.hud .dialog h1 {
    margin: 0;
    font-size: 26px;
    letter-spacing: 2px;
}

.hud .dialog p {
    margin: 0;
    font-size: 15px;
    opacity: .85;
}

.hud .dialog button {
    pointer-events: auto;
    margin-top: 6px;
    padding: 10px 18px;
    font: inherit;
    font-size: 14px;
    letter-spacing: 1px;
    color: #ffffff;
    text-shadow: 2px 2px 0 #000000;
    background: #3c8527;
    border: 2px solid #000000;
    box-shadow: inset 2px 2px 0 #ffffff33, inset -2px -2px 0 #00000080;
    cursor: pointer;
}

.hud .dialog button:active {
    background: #2f6b1f;
}

.hud .hidden {
    display: none;
}
`;

const icon = (name: string, className = "") => `<img class="${className}" src="${textureFileUrl(name)}" alt="">`;

export interface Hud {
    update(state: GameState, project: (x: number, y: number) => { x: number; y: number; }): void;
    onRestart(handler: () => void): void;
}

export function createHud(): Hud {
    document.head.insertAdjacentHTML("beforeend", `<style>${style}</style>`);
    const root = document.createElement("div");
    root.className = "hud";
    root.innerHTML = `
        <div class="top">
            <div>
                <div class="panel coins">${icon(boardTextures.coin)}<span data-coins>0</span></div>
                <div class="round" data-round>ROUND 1</div>
            </div>
            <div class="orders" data-orders></div>
        </div>
        <div class="panel chain" data-chain></div>
        <div class="hint hidden" data-hint>SLIDE, RELEASE TO SHOOT</div>
        <div class="banner hidden" data-banner></div>
        <div class="floats" data-floats></div>
        <div class="flights" data-flights></div>
        <div class="panel dialog hidden" data-dialog>
            <h1>SERVING ZONE BLOCKED</h1>
            <p data-summary></p>
            <button type="button" data-restart>PLAY AGAIN</button>
        </div>
    `;
    document.body.append(root);

    const query = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;
    const coinsEl = query<HTMLSpanElement>("[data-coins]");
    const roundEl = query<HTMLDivElement>("[data-round]");
    const ordersEl = query<HTMLDivElement>("[data-orders]");
    const chainEl = query<HTMLDivElement>("[data-chain]");
    const hintEl = query<HTMLDivElement>("[data-hint]");
    const bannerEl = query<HTMLDivElement>("[data-banner]");
    const floatsEl = query<HTMLDivElement>("[data-floats]");
    const flightsEl = query<HTMLDivElement>("[data-flights]");
    const dialogEl = query<HTMLDivElement>("[data-dialog]");
    const summaryEl = query<HTMLParagraphElement>("[data-summary]");
    const restartEl = query<HTMLButtonElement>("[data-restart]");

    chainEl.innerHTML = itemTiers.map((tier, index) => `${index === 0 ? "" : "<span>·</span>"}${icon(tier.texture)}`).join("");
    const chainIcons = Array.from(chainEl.querySelectorAll("img"));

    let orderKey = "";
    let coins = -1;
    let round = -1;
    let unlocked = -1;

    return {
        update(state, project) {
            if (state.coins !== coins) {
                coins = state.coins;
                coinsEl.textContent = `${coins}`;
            }
            if (state.round !== round) {
                round = state.round;
                roundEl.textContent = `ROUND ${round}`;
            }
            if (state.highestTier !== unlocked) {
                unlocked = state.highestTier;
                chainIcons.forEach((image, tier) => image.classList.toggle("unlocked", tier <= unlocked));
            }

            const key = state.orders.map(order => `${order.tier}:${order.done}`).join("|");
            if (key !== orderKey) {
                orderKey = key;
                ordersEl.innerHTML = state.orders.map(order => {
                    // the bigger the ask, the bigger the icon
                    const size = Math.round(26 + order.tier * 2.4);
                    return `
                    <div class="panel order${order.done ? " done" : ""}">
                        <div class="label">ORDER</div>
                        <div class="slot"><img class="item" style="width:${size}px;height:${size}px" src="${textureFileUrl(itemTiers[ order.tier ].texture)}" alt=""></div>
                        ${order.done ? `<div class="check">✔</div>` : ""}
                        <div class="reward">${icon(boardTextures.coin)}${order.reward}</div>
                    </div>
                `;
                }).join("");
            }

            hintEl.classList.toggle("hidden", state.shots > 2 || state.over);
            bannerEl.classList.toggle("hidden", !state.banner);
            if (state.banner) bannerEl.textContent = state.banner.text;

            while (floatsEl.children.length < state.texts.length) {
                floatsEl.append(Object.assign(document.createElement("div"), { className: "float" }));
            }
            Array.from(floatsEl.children).forEach((element, index) => {
                const text = state.texts[ index ];
                const node = element as HTMLDivElement;
                if (!text) {
                    node.classList.add("hidden");
                    return;
                }
                const point = project(text.x, text.y);
                node.classList.remove("hidden");
                node.textContent = text.text;
                node.style.color = text.color;
                node.style.opacity = `${Math.min(1, text.life * 1.6)}`;
                node.style.left = `${point.x}px`;
                node.style.top = `${point.y - (1.4 - text.life) * 26}px`;
            });

            // FLIP the delivered item from where it merged onto its order card
            while (flightsEl.children.length < state.flights.length) {
                flightsEl.append(Object.assign(document.createElement("img"), { className: "flight" }));
            }
            Array.from(flightsEl.children).forEach((element, index) => {
                const flight = state.flights[ index ];
                const node = element as HTMLImageElement;
                if (!flight) {
                    node.classList.add("hidden");
                    return;
                }
                const card = ordersEl.children[ flight.order ]?.querySelector<HTMLImageElement>("img.item");
                const target = card?.getBoundingClientRect();
                const from = project(flight.x, flight.y);
                const progress = Math.min(1, Math.max(0, 1 - flight.life / FLIGHT_TIME));
                const eased = 1 - (1 - progress) ** 3;
                const toX = target ? target.left + target.width / 2 : from.x;
                const toY = target ? target.top + target.height / 2 : 0;
                const size = (target ? target.width : 30) + (1 - eased) * 46;
                const source = textureFileUrl(itemTiers[ flight.tier ].texture);
                if (node.getAttribute("src") !== source) node.src = source;
                node.classList.remove("hidden");
                node.style.width = `${size}px`;
                node.style.height = `${size}px`;
                node.style.left = `${from.x + (toX - from.x) * eased - size / 2}px`;
                // a little arc on the way up
                node.style.top = `${from.y + (toY - from.y) * eased - Math.sin(eased * Math.PI) * 40 - size / 2}px`;
                node.style.transform = `rotateY(${eased * 540}deg)`;
                node.style.opacity = `${progress > 0.85 ? (1 - progress) / 0.15 : 1}`;
            });

            dialogEl.classList.toggle("hidden", !state.over);
            if (state.over) summaryEl.textContent = `${state.coins} coins · ${state.deliveries} orders served · round ${state.round}`;
        },
        onRestart(handler) {
            restartEl.addEventListener("click", handler);
        },
    };
}
