const lineWidth = 3;
const lineColor = 0x40e0d0;

function showWalls() {
    window.wallsOverlay = new PIXI.Graphics();
    window.wallsOverlay.lineStyle(lineWidth, lineColor);
    for (const quadtree of canvas.walls.quadtree.nodes) { // TODO A better way to fetch the whole list?
        for (const obj of quadtree.objects) {
            const wall = obj.t;
            if (wall.data.door || !wall.data.move) {
                continue;
            }
            const c = wall.data.c;
            window.wallsOverlay.moveTo(c[0], c[1]);
            window.wallsOverlay.lineTo(c[2], c[3]);
        }
    }
    canvas.drawings.addChild(window.wallsOverlay);
    canvas.terrain.visible = true;
}

function hideWalls() {
    window.wallsOverlay.destroy();
    window.wallsOverlay = undefined;
    canvas.terrain.visible = false;
}

if (typeof(window.wallsOverlay) === "undefined" || window.wallsOverlay === undefined || window.wallsOverlay === null) {
    console.log("Showing walls");
    showWalls();
} else {
    console.log("Hiding walls");
    hideWalls();
}