const C = require('../third_party/constants');

class RoomPosition {
    constructor(x, y, roomName) {
        this.x = x;
        this.y = y;
        this.roomName = roomName;
    }

    toJSON() {
        return `{"x": ${this.x}, "y": ${this.y}, "roomName": "${this.roomName}"}`;
    }

    inRangeTo(arg1, arg2, arg3) {
        let x = arg1;
        let y = arg2;
        let range = arg3;
        let roomName = this.roomName;

        if (arg3 === undefined) {
            let pos = arg1;
            if (arg1.pos) {
                pos = arg1.pos;
            }

            x = pos.x;
            y = pos.y;
            roomName = pos.roomName;
            range = arg2;
        }

        return Math.abs(x - this.x) <= range && Math.abs(y - this.y) <= range && roomName == this.roomName;
    }

    isNearTo(arg1, arg2) {
        if (arg2 === undefined) {
            return this.inRangeTo(arg1, 1);
        }

        return this.inRangeTo(arg1, arg2, 1);
    }

    isEqualTo(arg1, arg2) {
        if (arg2 === undefined) {
            return this.inRangeTo(arg1, 0);
        }

        return this.inRangeTo(arg1, arg2, 0);
    }

    getDirectionTo(arg1, arg2) {
        let x = arg1;
        let y = arg2;
        let roomName = this.roomName;
        if (arg2 === undefined) {
            let pos = arg1;
            if (arg1.pos) {
                pos = arg1.pos;
            }

            x = pos.x;
            y = pos.y;
            roomName = pos.roomName;
        }

        if (roomName == this.roomName) {
            const dx = x - this.x;
            const dy = y - this.y;
            return RoomPosition._getDirection(dx, dy);
        }

        const [thisRoomX, thisRoomY] = RoomPosition._roomNameToXY(this.roomName);
        const [thatRoomX, thatRoomY] = RoomPosition._roomNameToXY(roomName);

        return RoomPosition._getDirection(
            thatRoomX * 50 + x - thisRoomX * 50 - this.x,
            thatRoomY * 50 + y - thisRoomY * 50 - this.y,
        );
    }

    static _roomNameToXY(name) {
        let xx = parseInt(name.substr(1), 10);
        let verticalPos = 2;
        if (xx >= 100) {
            verticalPos = 4;
        } else if (xx >= 10) {
            verticalPos = 3;
        }
        let yy = parseInt(name.substr(verticalPos + 1), 10);
        let horizontalDir = name.charAt(0);
        let verticalDir = name.charAt(verticalPos);
        if (horizontalDir === 'W' || horizontalDir === 'w') {
            xx = -xx - 1;
        }
        if (verticalDir === 'N' || verticalDir === 'n') {
            yy = -yy - 1;
        }
        return [xx, yy];
    }

    static _getDirection(dx, dy) {
        let adx = Math.abs(dx),
            ady = Math.abs(dy);

        if (adx > ady * 2) {
            if (dx > 0) {
                return RIGHT;
            } else {
                return LEFT;
            }
        } else if (ady > adx * 2) {
            if (dy > 0) {
                return BOTTOM;
            } else {
                return TOP;
            }
        } else {
            if (dx > 0 && dy > 0) {
                return BOTTOM_RIGHT;
            }
            if (dx > 0 && dy < 0) {
                return TOP_RIGHT;
            }
            if (dx < 0 && dy > 0) {
                return BOTTOM_LEFT;
            }
            if (dx < 0 && dy < 0) {
                return TOP_LEFT;
            }
        }
    }
}

class RawMemory {
    constructor() {
        this._segmentData = {};
        this._activeSegments = [];
        this.segments = {};
    }

    setActiveSegments(ids) {
        if (ids.length > 10) {
            throw new Error(`Setting too many active segments: ${ids.length} > 10`);
        }

        for (const id of ids) {
            if (id >= 100) {
                throw new Error(`Requesting id out of bound: ${id} >= 100`);
            }
        }

        this._activeSegments = ids;
    }

    reset() {
        this._segmentData = {};
        this._activeSegments = [];
        this.segments = {};
    }

    tick() {
        let counter = 0;
        for (const id of Object.keys(this.segments)) {
            if (id >= 100) {
                throw new Error(`Updating id out of bound: ${id} >= 100`);
            }

            if (++counter > 10) {
                throw new Error(`Writing too many segments: ${Object.keys(this.segments).length} > 10`);
            }

            if (this.segments[id].length > 100000) {
                throw new Error(`Segment ${id} is too large: ${this.segments[id].length} > 100000`);
            }

            this._segmentData[id] = this.segments[id];
        }

        this.segments = {};
        for (const id of this._activeSegments) {
            this.segments[id] = this._segmentData[id];
        }
    }
}

class CPU {
    constructor() {}

    getUsed() {
        return 0;
    }
}

class MockWorld {
    constructor() {
        this.Memory = {};
        this.RawMemory = new RawMemory();
        this.cpu = new CPU();
    }

    reset() {
        for (const k of Object.keys(this.Memory)) {
            delete this.Memory[k];
        }
        this.RawMemory.reset();
    }

    tick() {
        this.RawMemory.tick();
    }
}

const MockedWorld = new MockWorld();

const Game = {
    time: 1000,
    shard: {
        name: '',
    },
    cpu: MockedWorld.cpu,
};

global = Object.assign(global, C);
global = Object.assign(global, {
    VX_TEST: 1,
    Game,
    Memory: {},
    RoomPosition,
    Memory: MockedWorld.Memory,
    RawMemory: MockedWorld.RawMemory,
    MockedWorld,
});
