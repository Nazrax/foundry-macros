// Main choices
const actionsToShow = 2;
const weaponRange = 30;
const showDifficultTerrain = false;
const showPathLines = false;
const showNumericMovementCost = false;
const fontSize = 20;

// Colors and widths
const colorByActions = [0x00ff00, 0xffff00, 0xff0000]; // green, yellow, red
const pathLineColor = 0x0000ff; // blue
const highlightLineColor = 0xffffff; // white
const pathLineWidth = 1;
const highlightLineWidth = 3;
const movementAlpha = 0.4; // 0 is completely transparent, 1 is completely opaque

// Don't mess with these
const MAX_DIST = 999;
const FEET_PER_TILE = 5;
const FUDGE = .1; // floating point fudge

//const rangeColor = 0xffa500; // orange
//const rangeAlpha = 0.3;
class GridTile {
  constructor(gx, gy) {
    this.gx = gx;
    this.gy = gy;
    this.distance = MAX_DIST;
    this.visited = false;
    this.upstreams = undefined;
    this._upstreamCache = undefined;
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

  get allUpstreams() {
    if (this._upstreamCache === undefined) {
      this._upstreamCache = new Map();
      if (this.upstreams !== undefined) {
        for (const upstream of this.upstreams) {
          this._upstreamCache.set(upstream.key, upstream);
          for (const upstream2 of upstream.allUpstreams.values()) {
            this._upstreamCache.set(upstream2.key, upstream2);
          }
        }
      }
    }
    return this._upstreamCache;
  }

  upstreamOf(tile) {
    return tile.allUpstreams.has(this.key);
  }
}

function currentToken() {
  return token;
}

function getSpeed() {
  const actor = currentToken() !== undefined ? currentToken().actor : game.user.character;
  const speedAttr = actor.data.data.attributes.speed;
  let speed = speedAttr.total ?? 0;
  // noinspection JSUnresolvedVariable
  speedAttr.otherSpeeds.forEach(otherSpeed => {
    if (otherSpeed.total > speed) {
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

function calculateTargetRangeSet() {
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

function buildRangeMap(targetSet) {
  const rangeMap = new Map();
  for (const tileSet of targetSet.values()) {
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
  return rangeMap;
}

function calculateIdealTileMap(movementTileMap, targetSet, rangeMap) {
  const idealTileMap = new Map();
  for (const tile of movementTileMap.values()) {
    if (rangeMap.get(tile.key) === targetSet.size) { // Every target is reachable from here
      idealTileMap.set(tile.key, tile);
    }
  }
  return idealTileMap;
}

function drawCosts(tileMap, targetSet) {
  const rangeMap = buildRangeMap(targetSet);
  const idealTileMap = calculateIdealTileMap(tileMap, targetSet, rangeMap);
  if (targetSet.size > 0 && idealTileMap.size === 0) {
    ui.notifications.warn("No tiles are within movement range AND attack range")
    return;
  }

  const movementSpeed = getSpeed() / 5;
  window.distanceTexts = [];
  window.distanceOverlay = new PIXI.Graphics();
  window.pathOverlay = new PIXI.Graphics();
  window.pathOverlay.lineStyle(pathLineWidth, pathLineColor);

  // Set line for paths
  for (const tile of tileMap.values()) {
    let drawTile = false;
    if (targetSet.size === 0 || idealTileMap.has(tile.key)) {
      drawTile = true;
    } else {
      for (const idealTile of idealTileMap.values()) {
        if (tile.upstreamOf(idealTile)) {
          drawTile = true;
          break;
        }
      }
    }
    if (drawTile) {
      // Annotate distance
      if (showNumericMovementCost) {
        const text = new PIXI.Text(tile.distance, {fontFamily: 'Arial', fontSize: fontSize, fill: pathLineColor});
        const pt = tile.pt;
        text.position.x = pt.x;
        text.position.y = pt.y;
        window.distanceTexts.push(text);
      }

      // Annotate upstream
      if (showPathLines) {
        let squareCenter = tile.centerPt;
        if (tile.upstreams !== undefined) {
          for (const upstream of tile.upstreams) {
            let upstreamCenter = upstream.centerPt;
            window.pathOverlay.moveTo(squareCenter.x, squareCenter.y);
            window.pathOverlay.lineTo(upstreamCenter.x, upstreamCenter.y);
          }
        }
      }

      // Color tile based on movement
      let color = colorByActions[Math.floor(Math.floor(tile.distance - 1 + FUDGE) / movementSpeed)];
      let cornerPt = tile.pt;
      if (idealTileMap.has(tile.key)) {
        //window.distanceOverlay.lineStyle(highlightLineWidth, color);
        window.distanceOverlay.lineStyle(highlightLineWidth, highlightLineColor);
      } else {
        window.distanceOverlay.lineStyle(0, 0);
      }
      window.distanceOverlay.beginFill(color, movementAlpha);
      window.distanceOverlay.drawRect(cornerPt.x, cornerPt.y, canvas.grid.size, canvas.grid.size);
      window.distanceOverlay.endFill();
    }
  }

  canvas.drawings.addChild(window.distanceOverlay);
  canvas.drawings.addChild(window.pathOverlay);

  for (const text of window.distanceTexts) {
    canvas.drawings.addChild(text);
  }

  if (showDifficultTerrain) {
    canvas.terrain.visible = true;
  }
}

function clearAll() {
  window.distanceTexts.forEach(t => {t.destroy()});
  window.distanceTexts = [];
  window.distanceOverlay.destroy();
  window.distanceOverlay = undefined;
  window.pathOverlay.destroy();
  window.pathOverlay = undefined;

  if (showDifficultTerrain) {
    canvas.terrain.visible = false;
  }
}

if (typeof(window.distanceOverlay) == "undefined") {
  const movementSquares = calculateMovementCosts();
  const targetSet = calculateTargetRangeSet();

  drawCosts(movementSquares, targetSet);
} else {
  clearAll();
}
