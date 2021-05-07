// TODO Use const once dev is done
let actionsToShow = 2;
let colorByActions = [0x00ff00, 0xffff00, 0xff0000]; // green, yellow, red
let movementAlpha = 0.3;
let showDifficultTerrain = true;
let showPathLines = true;
let showNumericMovementCost = true;
let weaponRange = 25;
let rangeColor = 0xffa500; // orange
let rangeAlpha = 0.3;
let lineWidth = 5;
let MAX_DIST = 999; 
let FEET_PER_TILE = 5;
let FUDGE = .1; // floating point fudge

class GridTile {
  constructor(gx, gy) {
    this.gx = gx;
    this.gy = gy;
    this.distance = MAX_DIST;
    this.visited = false;
    this.upstreams = undefined;
  }

  static fromPixels(x, y) {
    const [gx, gy] = canvas.grid.grid.getGridPositionFromPixels(x, y);
    return new GridTile(gx, gy);
  }

  get centerPt() {
    const pixels = canvas.grid.grid.getPixelsFromGridPosition(this.gx, this.gy);
    return { x: pixels[0]+canvas.grid.size/2, y: pixels[1]+canvas.grid.size/2 };
  }

  get pt() {
    const pixels = canvas.grid.grid.getPixelsFromGridPosition(this.gx, this.gy);
    return { x: pixels[0], y: pixels[1] };
  }

  get key() {
    return `${this.gx}-${this.gy}`;
  }

  get cost() {
    return canvas.terrain.cost({x: this.gy, y: this.gx});
  }
}

function currentToken() {
 // noinspection JSUnresolvedVariable
  return canvas.tokens.controlled[0];
}

function getSpeed() {
  const speedAttr = currentToken().actor.data.data.attributes.speed;
  let speed = speedAttr.total;
  // noinspection JSUnresolvedVariable
  speedAttr.otherSpeeds.forEach(otherSpeed => {
    if (otherSpeed.name === "Fly Speed" && otherSpeed.total > speed) {
      speed = otherSpeed.total;
    }
  })
  return speed;
}

function calculateGridDistance(pt1, pt2) {
  const dx = Math.abs(pt1.x - pt2.x)
  const dy = Math.abs(pt1.y - pt2.y);
  return Math.abs(dx - dy) + Math.floor(Math.min(dx, dy) * 3 / 2);
}

function calculateMovementCosts() {
  const tilesPerAction = getSpeed() / FEET_PER_TILE;
  const maxTiles = tilesPerAction * actionsToShow;

  const tokenTile = GridTile.fromPixels(currentToken().x, currentToken().y);
  tokenTile.distance = 0;
  tokenTile.visited = true;

  // Keep a map of grid coordinate -> GridTile
  const tileMap = new Map();
  tileMap.set(tokenTile.key, tokenTile);

  const toVisit = new Set();
  toVisit.add(tokenTile);

  while (toVisit.size > 0) {
    let current = new GridTile(undefined, undefined);

    for (const tile of toVisit) {
      if (tile.distance < current.distance) {
        current = tile;
      }
    }
    if (current.distance === MAX_DIST) {
      break;
    }
    toVisit.delete(current);
    current.visited = true;

    const neighborGridXYs = canvas.grid.grid.getNeighbors(current.gx, current.gy);
    for (const neighborGridXY of neighborGridXYs) {
      let neighbor = new GridTile(neighborGridXY[0], neighborGridXY[1]);
      if (tileMap.has(neighbor.key)) {
        neighbor = tileMap.get(neighbor.key);
      } else {
        tileMap.set(neighbor.key, neighbor);
      }

      const ray = new Ray(neighbor.centerPt, current.centerPt);
      if (neighbor.visited) {
        continue;
      } else if (canvas.walls.checkCollision(ray, {blockMovement: true, blockSenses: false, mode: 'any'})) {
        // Blocked, do nothing
        //console.log(`${neighbor.key} (${neighbor.centerPt.x}/${neighbor.centerPt.y}) is blocked from ${current.key} (${current.centerPt.x}/${current.centerPt.y})`);
      } else {
        let newDistance = current.distance + neighbor.cost;
        if (current.gx !== neighbor.gx && current.gy !== neighbor.gy) { // diagonals
          newDistance += .5;
        }

        if (Math.floor(newDistance+FUDGE) > maxTiles) {
          continue; // Don't add the neighbor to toVisit
        } else if (Math.abs(neighbor.distance - newDistance) < .1) { // floating point equality
          neighbor.upstreams.add(current);
        } else if (newDistance < neighbor.distance) {
          neighbor.upstreams = new Set();
          neighbor.upstreams.add(current);
          neighbor.distance = newDistance;
        }
      }
      toVisit.add(neighbor);
    }
  }

  // Filter out any tiles which have distance 999 (unreachable) or 0 (origin)
  return new Map([...tileMap].filter(kv => kv[1].distance !== MAX_DIST && kv[1].distance > FUDGE));
}

function calculateTargetRanges() {
  const targetSet = new Set();
  const weaponRangeInTiles = weaponRange / FEET_PER_TILE;

  for (const target of game.user.targets) {
    const tileSet = new Set();
    const targetTile = GridTile.fromPixels(target.x, target.y);
    const tgx = targetTile.gx;
    const tgy = targetTile.gy;
    const tgh = Math.floor(target.hitArea.height / canvas.grid.size);
    const tgw = Math.floor(target.hitArea.width / canvas.grid.size);
    const targetCornerPts = [
      [target.x, target.y],
      [target.x + target.hitArea.width, target.y],
      [target.x, target.y + target.hitArea.height],
      [target.x + target.hitArea.width, target.y + target.hitArea.height],
      [target.x + target.hitArea.width/2, target.y + target.hitArea.height/2]
    ];

    for(let dgx=0; dgx <= weaponRangeInTiles; dgx++) {
      for(let dgy=0; dgy <= weaponRangeInTiles; dgy++) {
        if (dgx === 0 && dgy === 0) {
          continue;
        }

        const shotDistance = calculateGridDistance({x: 0, y: 0}, {x: dgx, y: dgy});
        if (shotDistance < weaponRangeInTiles + .1) { // Close enough
          const gxSet = new Set();
          const gySet = new Set();
          gxSet.add(tgx + dgx + tgw - 1);
          gxSet.add(tgx - dgx);
          gySet.add(tgy + dgy + tgh - 1);
          gySet.add(tgy - dgy);
          for (const sgx of gxSet) {
            for (const sgy of gySet) {
              const farSquare = new GridTile(sgx, sgy);
              const fPt = farSquare.pt;
              const farCornerPts = [
                //[fPt.x, fPt.y],
                //[fPt.x + canvas.grid.size, fPt.y],
                //[fPt.x, fPt.y + canvas.grid.size],
                //[fPt.x + canvas.grid.size, fPt.y + canvas.grid.size],
                [fPt.x + canvas.grid.size/2, fPt.y + canvas.grid.size/2]
              ];

              let clearShot = false;
              for (const farCornerPt of farCornerPts) {
                for (const targetCornerPt of targetCornerPts) {
                  const ray = new Ray({x: farCornerPt[0], y: farCornerPt[1]}, {x: targetCornerPt[0], y: targetCornerPt[1]});
                  // noinspection JSUnresolvedFunction
                  if (!canvas.walls.checkCollision(ray, {blockMovement: false, blockSenses: true, mode: 'any'})) {
                    clearShot = true;
                    break;
                  }
                }
              }
              /*
              const ray = new Ray(farSquare.centerPt, target.center)
              const clearShot = !canvas.walls.checkCollision(ray, {blockMovement: false, blockSenses: true, mode: 'any'});
              */
              if (clearShot) {
                tileSet.add(farSquare);
              }
            }
          }
        }
      }
    }
    targetSet.add(tileSet);
  }
  return targetSet;
}

function drawMovementCosts(tileMap) {
  const movementSpeed = getSpeed() / 5;
  window.distTexts = [];
  window.distTiles = new PIXI.Graphics();
  window.distLines = new PIXI.Graphics();
  window.distLines.lineStyle(2, 0x0000ff);

  for (const tile of tileMap.values()) {
    // Annotate distance
    if (showNumericMovementCost) {
      const text = new PIXI.Text(tile.distance, {fontFamily: 'Arial', fontSize: 16, fill: 0x0000ff});
      const pt = tile.pt;
      text.position.x = pt.x;
      text.position.y = pt.y;
      window.distTexts.push(text);
    }

    // Annotate upstream
    if (showPathLines) {
      let squareCenter = tile.centerPt;
      if (tile.upstreams !== undefined) {
        for (const upstream of tile.upstreams) {
          let upstreamCenter = upstream.centerPt;
          window.distLines.moveTo(squareCenter.x, squareCenter.y);
          window.distLines.lineTo(upstreamCenter.x, upstreamCenter.y);
        }
      }
    }

    // Color tile
    let color = colorByActions[Math.floor(Math.floor(tile.distance-1+FUDGE)/movementSpeed)];
    let cornerPt = tile.pt;
    window.distTiles.beginFill(color, movementAlpha);
    window.distTiles.drawRect(cornerPt.x, cornerPt.y, canvas.grid.size, canvas.grid.size);
    window.distTiles.endFill();
  }

  for (const text of window.distTexts) {
    canvas.drawings.addChild(text);
  }
  canvas.drawings.addChild(window.distTiles);
  canvas.drawings.addChild(window.distLines);
  if (showDifficultTerrain) {
    canvas.terrain.visible = true;
  }
}

function drawRanges(targetSet) {
  window.rangeTiles = new PIXI.Graphics();
  window.rangeTiles.beginFill(rangeColor, rangeAlpha);
  for (const tileSet of targetSet) {
    for (const tile of tileSet) {
      let cornerPt = tile.pt;
      window.rangeTiles.drawRect(cornerPt.x, cornerPt.y, canvas.grid.size, canvas.grid.size);
    }
  }
  window.rangeTiles.endFill(); 
  canvas.drawings.addChild(window.rangeTiles);
}

function drawHighlights(movementTileMap, targetSet) {
  const tilesPerAction = getSpeed() / 5;
  window.highlightTiles = new PIXI.Graphics();

  const rangeMap = new Map();
  for (const tileSet of targetSet) {
    for (const tile of tileSet) {
      const tileKey = tile.key;
      let count = rangeMap.get(tileKey)
      if (count === undefined) {
        count = 0;
      }
      count++;
      rangeMap.set(tileKey, count);
    }
  }

  for (const tile of movementTileMap.values()) {
    if (rangeMap.get(tile.key) === targetSet.size) { // Every target is reachable from here
      const color = colorByActions[Math.floor(Math.floor(tile.distance-1+FUDGE)/tilesPerAction)];
      window.highlightTiles.lineStyle(lineWidth, color);
      window.highlightTiles.drawRect(tile.pt.x, tile.pt.y, canvas.grid.size, canvas.grid.size);
    }
  }
  canvas.drawings.addChild(window.highlightTiles);
}

function clearCosts() {
  window.distTexts.forEach(t => {t.destroy()});
  window.distTexts = [];
  window.distLines.destroy();
  window.distTiles.destroy();
  if (showDifficultTerrain) {
    canvas.terrain.visible = false;
  }
  window.distTiles = undefined;
  window.distLines = undefined;
}

function clearRanges() {
  window.rangeTiles.destroy();
  window.rangeTiles = undefined;
}

function clearHighlights() {
  window.highlightTiles.destroy();
  window.highlightTiles = undefined;
}

if (typeof(window.distTiles) == "undefined") {
  console.log("Showing distances")
  const movementSquares = calculateMovementCosts();
  const rangeSquares = calculateTargetRanges();

  drawMovementCosts(movementSquares);
  drawRanges(rangeSquares);
  drawHighlights(movementSquares, rangeSquares);
} else {
  console.log("Hiding distances")
  clearCosts();
  clearRanges();
  clearHighlights();
}
