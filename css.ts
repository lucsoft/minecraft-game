document.head.innerHTML += `<style> body,
html {
    margin: 0;
    padding: 0;
}

body {
    display: grid;
    height: 100dvh;
    grid-template-columns: 1fr;
    grid-template-rows: 100%;
}

canvas {
    width: 100%;
    height: 100%;
    aspect-ratio: unset;
}

canvas:focus {
    outline: none;
} </style>`;