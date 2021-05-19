// Main choices
const actionsToShow = 2;
const weaponRange = 60;
const showDifficultTerrain = true;
const showNumericMovementCost = false;
const showPathLines = false;
const showPotentialTargets = true;
const showTurnOrder = true;
const showWalls = true;
const roundNumericMovementCost = true;

// Colors
const colorByActions = [0xffffff, 0x00ff00, 0xffff00, 0xff0000, 0x800080]; // white, green, yellow, red, purple
const highlightLineColor = 0xffffff; // white
const pathLineColor = 0x0000ff; // blue
const wallLineColor = 0x40e0d0; // turquise
const movementAlpha = 0.3; // 0 is completely transparent, 1 is completely opaque

// Line widths
const wallLineWidth = 3;
const pathLineWidth = 1;
const highlightLineWidth = 3;
const potentialTargetLineWidth = 3;

// Fonts
const movementCostStyle = {
  fontFamily: 'Arial',
  fontSize: 30,
  fill: 0x0000ff, // blue
  stroke: 0xffffff, // white
  strokeThickness: 1
};

const turnOrderStyle = {
  fontFamily: 'Arial',
  fontSize: 40,
  fill: 0xffffff, // white
  stroke: 0x000000, // black
  strokeThickness: 6
};

////////////////////////
//// Main program //////
////////////////////////
// Don't mess with these
const MAX_DIST = 999;
const FEET_PER_TILE = 5;
const FUDGE = .1; // floating point fudge

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

  isDiagonal(neighbor) {
    return this.gx !== neighbor.gx && this.gy !== neighbor.gy;
  }
}

// TODO Use non-macro method
function getCurrentToken() {
  // noinspection JSUnresolvedVariable
  return token;
}

function getSpeed() {
  const actor = getCurrentToken() !== undefined ? getCurrentToken().actor : game.user.character;
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

// Use Dijkstra's shortest path algorithm
function calculateMovementCosts() {
  const tilesPerAction = getSpeed() / FEET_PER_TILE;
  const maxTiles = tilesPerAction * actionsToShow;

  const currentToken = getCurrentToken();
  const tokenTile = GridTile.fromPixels(currentToken.x, currentToken.y);
  tokenTile.distance = 0;

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
    if (current.distance === MAX_DIST) { // Stop if cheapest tile is unreachable
      break;
    }
    toVisit.delete(current);
    if (current.visited) {
      console.log("BUG: Trying to visit a tile twice");
      continue;
    }
    current.visited = true;

    const neighborGridXYs = canvas.grid.grid.getNeighbors(current.gx, current.gy);
    for (const neighborGridXY of neighborGridXYs) {
      let neighbor = new GridTile(neighborGridXY[0], neighborGridXY[1]);
      if (tileMap.has(neighbor.key)) {
        neighbor = tileMap.get(neighbor.key);
      } else {
        tileMap.set(neighbor.key, neighbor);
      }

      if (neighbor.visited) {
        continue;
      }

      const ray = new Ray(neighbor.centerPt, current.centerPt);
      if (checkCollision(ray, {blockMovement: true, blockSenses: false, mode: 'any'})) {
        // Blocked, do nothing
        //console.log(`${neighbor.key} (${neighbor.centerPt.x}/${neighbor.centerPt.y}) is blocked from ${current.key} (${current.centerPt.x}/${current.centerPt.y})`);
      } else {
        let newDistance = current.distance + neighbor.cost;
        if (current.isDiagonal(neighbor)) { // diagonals
          newDistance += .5;
        }

        if (Math.floor(newDistance+FUDGE) > maxTiles) {
          // Do nothing
        } else if (Math.abs(neighbor.distance - newDistance) < FUDGE) {
          neighbor.upstreams.add(current);
        } else if (newDistance < neighbor.distance) {
          neighbor.upstreams = new Set();
          neighbor.upstreams.add(current);
          neighbor.distance = newDistance;
          toVisit.add(neighbor);
        }
      }
    }
  }

  // Filter out any tiles which have distance 999 (unreachable)
  return new Map([...tileMap].filter(kv => kv[1].distance !== MAX_DIST));
}

// Abstract this because IntelliJ complains that canvas.walls.checkCollision isn't accessible and we don't want to annotate it everywhere
function checkCollision(ray, opts) {
  // noinspection JSUnresolvedFunction
  return canvas.walls.checkCollision(ray, opts);
}

function calculateTilesInRange(rangeInTiles, targetToken) {
  const targetTile = GridTile.fromPixels(targetToken.x, targetToken.y);
  const tileSet = new Set();
  const targetGridX = targetTile.gx;
  const targetGridY = targetTile.gy;
  const targetGridHeight = Math.floor(targetToken.hitArea.height / canvas.grid.size);
  const targetGridWidth = Math.floor(targetToken.hitArea.width / canvas.grid.size);

  // Loop over X and Y deltas, computing distance for only a single quadrant
  for(let gridXDelta = 0; gridXDelta <= rangeInTiles; gridXDelta++) {
    for(let gridYDelta = 0; gridYDelta <= rangeInTiles; gridYDelta++) {
      if (gridXDelta === 0 && gridYDelta === 0) {
        continue;
      }

      const shotDistance = calculateGridDistance({x: 0, y: 0}, {x: gridXDelta, y: gridYDelta});
      if (shotDistance < rangeInTiles + FUDGE) { // We're within range
        // We need to test visibility for all 4 quadrants
        // Use sets so we don't have to explicitly test for "on the same row/column as"
        const gridXSet = new Set();
        const gridYSet = new Set();
        gridXSet.add(targetGridX + gridXDelta + targetGridWidth - 1);
        gridXSet.add(targetGridX - gridXDelta);
        gridYSet.add(targetGridY + gridYDelta + targetGridHeight - 1);
        gridYSet.add(targetGridY - gridYDelta);
        for (const testGridX of gridXSet) {
          for (const testGridY of gridYSet) {
            const testTile = new GridTile(testGridX, testGridY);
            //const testTilePoint = testTile.pt;

            let clearShot = checkTileToTokenVisibility(testTile, targetToken);
            if (clearShot) {
              tileSet.add(testTile);
            }
          }
        }
      }
    }
  }
  return tileSet;
}

function calculateTargetRangeSet() {
  const targetSet = new Set();
  const weaponRangeInTiles = weaponRange / FEET_PER_TILE;

  for (const targetToken of game.user.targets) {
    targetSet.add(calculateTilesInRange(weaponRangeInTiles, targetToken));
  }
  return targetSet;
}

function buildRangeMap(targetSet) {
  const rangeMap = new Map();
  for (const tileSet of targetSet.values()) {
    for (const tile of tileSet) {
      const tileKey = tile.key;
      let count = rangeMap.get(tileKey) ?? 0;
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

// For some reason the combatant just has the data structure, not the Token
function getCombatantToken(combatant) {
  // noinspection JSUnresolvedFunction
  return canvas.tokens.get(combatant.tokenId);
}

function drawPotentialTargets(movementCosts) {
  //const currentToken = getCurrentToken();
  const tilesMovedPerAction = getSpeed() / FEET_PER_TILE;
  const weaponRangeInTiles = weaponRange / FEET_PER_TILE;

  if (game.combat === null) {
    return;
  }

  for (const combatant of game.combat.combatants) {
    const combatantToken = getCombatantToken(combatant);
    if (!combatantToken.actor.hasPlayerOwner && combatantToken.data.disposition === -1) { // Hostile NPC
    //if (true) {
      //if (checkTokenVisibility(currentToken, combatantToken)) {
      //const tolerance = Math.min(combatantToken.w, combatantToken.h) / 4;
      console.log(combatantToken);
      if (combatantToken.visible) {
        let tilesInRange = calculateTilesInRange(weaponRangeInTiles, combatantToken);
        let bestCost = MAX_DIST;

        for (const tileInRange of tilesInRange) {
          const costTile = movementCosts.get(tileInRange.key)
          if (costTile === undefined) {
            continue;
          }
          if (costTile.distance < bestCost) {
            bestCost = costTile.distance;
          }
        }

        const colorIndex = Math.min(Math.ceil(bestCost / tilesMovedPerAction), colorByActions.length-1);
        let color = colorByActions[colorIndex];
        window.potentialTargetOverlay.lineStyle(potentialTargetLineWidth, color)
        window.potentialTargetOverlay.drawCircle(
          combatantToken.x + combatantToken.hitArea.width/2,
          combatantToken.y + combatantToken.hitArea.height/2,
          Math.pow(Math.pow(combatantToken.hitArea.width/2, 2) + Math.pow(combatantToken.hitArea.height/2, 2), .5)
        );
      }
    }
  }
  canvas.drawings.addChild(window.potentialTargetOverlay);
}

// Copied straight from foundry.js (_sortCombatants)
function combatantComparator(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : -9999;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : -9999;
    let ci = ib - ia;
    if ( ci !== 0 ) return ci;
    let [an, bn] = [a.token?.name || "", b.token?.name || ""];
    let cn = an.localeCompare(bn);
    if ( cn !== 0 ) return cn;
    return a.tokenId - b.tokenId;
}

function checkTileToTokenVisibility(tile, token) {
  const t = Math.min(token.h, token.w) / 4;
  const offsets = t > 0 ? [[0, 0],[-t,0],[t,0],[0,-t],[0,t],[-t,-t],[-t,t],[t,t],[t,-t]] : [[0,0]];
  const points = offsets.map(o => new PIXI.Point(token.center.x + o[0], token.center.y + o[1]));
  const tileCenterPt = tile.centerPt

  let isVisible = false;
  for (const point of points) {
    //console.log(`Shooting ray from ${tileCenterPt.x}/${tileCenterPt.y} to ${point.x}/${point.y}`)
    const ray = new Ray(tileCenterPt, point);
    if (!checkCollision(ray, {blockMovement: false, blockSenses: true, mode: 'any'})) {
      return true;
    }
  }

  return false;
}

function drawTurnOrder() {
  const currentToken = getCurrentToken();
  const currentTokenId = currentToken.id;
  if (game.combat === null) {
    return;
  }
  const sortedCombatants = game.combat.combatants.sort(combatantComparator)
  let seenCurrent = false;
  let turnOrder = 0;
  let i=0;
  let j=0;

  while(i < sortedCombatants.length) {
    if (j++ > sortedCombatants.length * 3) {
      throw "Got into an infinite loop in drawTurnOrder"
    }

    const combatant = sortedCombatants[i];
    const combatantTokenId = combatant.token._id
    // noinspection JSUnresolvedFunction
    const combatantToken = canvas.tokens.get(combatantTokenId);
    if (!seenCurrent && combatantTokenId === currentTokenId) {
      seenCurrent = true;
    }
    if (!seenCurrent) {
      sortedCombatants.push(sortedCombatants.shift()); // Move first element to last element
    } else {
      if (turnOrder > 0 && combatantToken.visible) {
        const text = new PIXI.Text(turnOrder, turnOrderStyle);
        text.position.x = combatantToken.x + combatantToken.hitArea.width / 2 - text.width / 2;
        text.position.y = combatantToken.y + combatantToken.hitArea.height / 2 - text.height / 2;
        window.turnOrderTexts.push(text);
      }
      turnOrder++
      i++;
    }
  }

  for (const text of window.turnOrderTexts) {
    canvas.tokens.addChild(text);
  }
}

function drawCosts(movementCostMap, targetRangeSet) {
  const rangeMap = buildRangeMap(targetRangeSet);
  const idealTileMap = calculateIdealTileMap(movementCostMap, targetRangeSet, rangeMap);
  if (targetRangeSet.size > 0 && idealTileMap.size === 0) {
    ui.notifications.warn("No tiles are within movement range AND attack range")
    return;
  }

  const tilesMovedPerAction = getSpeed() / FEET_PER_TILE;
  window.distanceTexts = [];
  window.pathOverlay.lineStyle(pathLineWidth, pathLineColor);

  for (const tile of movementCostMap.values()) {
    let drawTile = false;
    if (targetRangeSet.size === 0 || idealTileMap.has(tile.key)) {
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
        const label = roundNumericMovementCost ? Math.floor(tile.distance + FUDGE) : tile.distance;
        const text = new PIXI.Text(label, movementCostStyle);
        const pt = tile.pt;
        text.position.x = pt.x;
        text.position.y = pt.y;
        window.distanceTexts.push(text);
      }

      // Show pathing
      if (showPathLines) {
        let tileCenter = tile.centerPt;
        if (tile.upstreams !== undefined) {
          for (const upstream of tile.upstreams) {
            let upstreamCenter = upstream.centerPt;
            window.pathOverlay.moveTo(tileCenter.x, tileCenter.y);
            window.pathOverlay.lineTo(upstreamCenter.x, upstreamCenter.y);
          }
        }
      }

      // Color tile based on movement
      const colorIndex = Math.min(Math.ceil(Math.floor(tile.distance + FUDGE) / tilesMovedPerAction), colorByActions.length-1);
      let color = colorByActions[colorIndex];
      let cornerPt = tile.pt;
      if (idealTileMap.has(tile.key)) {
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
}

function drawWalls() {
  window.wallsOverlay.lineStyle(wallLineWidth, wallLineColor);
  for (const quadtree of canvas.walls.quadtree.nodes) {
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
}

function clearAll() {
  window.distanceTexts.forEach(t => {t.destroy()});
  window.turnOrderTexts.forEach(t => {t.destroy()});
  window.distanceTexts = [];
  window.distanceOverlay.destroy();
  window.distanceOverlay = undefined;
  window.pathOverlay.destroy();
  window.pathOverlay = undefined;
  window.turnOrderTexts = [];
  window.potentialTargetOverlay.destroy();
  window.potentialTargetOverlay = undefined;
  window.wallsOverlay.destroy();
  window.wallsOverlay = undefined;

  if (showDifficultTerrain) {
    canvas.terrain.visible = false;
  }
}

function initializePersistentVariables() {
  window.distanceTexts = [];
  window.turnOrderTexts = [];

  window.distanceOverlay = new PIXI.Graphics();
  window.pathOverlay = new PIXI.Graphics();
  window.potentialTargetOverlay = new PIXI.Graphics();
  window.wallsOverlay = new PIXI.Graphics();
}

if (typeof(window.distanceOverlay) === "undefined") {
  const movementCosts = calculateMovementCosts();
  const targetRangeSet = calculateTargetRangeSet();

  initializePersistentVariables();
  drawCosts(movementCosts, targetRangeSet);
  if (game.user.targets.size === 0) {
    if (showTurnOrder) {
      drawTurnOrder();
    }

    if (showPotentialTargets) {
      drawPotentialTargets(movementCosts);
    }
  }

  if (showWalls) {
    drawWalls();
  }

  if (showDifficultTerrain) {
    canvas.terrain.visible = true;
  }
} else {
  clearAll();
}
